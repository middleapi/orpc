import type { JsonSchema } from '@orpc/json-schema'
import { setOwn } from '@orpc/shared'

import { collectDefRefs, fromRef } from './schema-utils.ts'

/**
 * How a value is written: by the OpenAPI JSON serializer, by `JSON.stringify` (inside class
 * instances, which the serializer leaves to it), or by either one (a view of a class, like
 * `Readonly<C>`, holds an instance or a plain object the serializer walks).
 */
export type ConversionMode = 'serializer' | 'stringify' | 'either'

/** Keys of the `either` mode come after all type ids */
const EITHER_KEY_OFFSET = 2 ** 40

/**
 * The conversion key of a type in a mode, for a type that converts differently in it than under
 * the serializer: `JSON.stringify` keys are negative, `either` keys come after the type ids.
 */
export function toModeKey(id: number, mode: Exclude<ConversionMode, 'serializer'>): number {
  return mode === 'stringify' ? -id : id + EITHER_KEY_OFFSET
}

/**
 * The suffix of the def name of a type in the mode of a key, so names do not depend on which
 * mode was converted first: `Json` under `JSON.stringify`, `Any` for either one.
 */
function getModeSuffix(key: number): string {
  return key < 0 ? 'Json' : key >= EITHER_KEY_OFFSET ? 'Any' : ''
}

export interface Def {
  name: string
  /** The conversion key of the type */
  key: number
  schema?: JsonSchema
  /** The defs the schema refers to, computed once the schema is final */
  deps?: Set<string>
}

/**
 * Def names shared by the registries of one program (the converters for inputs and outputs),
 * so a type gets the same name in both.
 */
export class DefNames {
  readonly byKey = new Map<number, string>()
  readonly used = new Set<string>()
}

/**
 * The defs and shared results of the conversions, by the conversion key of their type.
 * What a conversion adds can be discarded, when it failed or depends on where it started.
 */
export class DefRegistry {
  private readonly defs = new Map<number, Def>()
  private readonly defsByName = new Map<string, Def>()
  /** Names emitted by discarded conversions */
  private readonly reservedNames = new Set<string>()
  /**
   * Finished conversions of anonymous types, shared between their uses,
   * and of named types whose schema is clearer inline, like `type UserId = string & { ... }`
   */
  private readonly anonymous = new Map<number, JsonSchema>()

  private createdDefs: Def[] = []
  private createdAnonymous: number[] = []

  get(key: number): Def | undefined {
    return this.defs.get(key)
  }

  getAnonymous(key: number): JsonSchema | undefined {
    return this.anonymous.get(key)
  }

  /**
   * Whether the def of the type is being converted, so its schema is not final yet.
   */
  isConverting(key: number): boolean {
    const def = this.defs.get(key)
    return def !== undefined && def.schema === undefined
  }

  constructor(private readonly names = new DefNames()) {}

  create(key: number, preferredName: string): Def {
    const taken = (name: string) => this.defsByName.has(name) || this.reservedNames.has(name)
    let name = this.names.byKey.get(key)

    if (name === undefined || taken(name)) {
      const base = `${preferredName}${getModeSuffix(key)}`
      // `Page_1` and `Page_12` must not collide as `Page_12`
      const separator = /\d$/u.test(base) ? '_' : ''
      name = base
      for (let i = 2; taken(name) || this.names.used.has(name); i++) {
        name = `${base}${separator}${i}`
      }

      this.names.byKey.set(key, name)
      this.names.used.add(name)
    }

    const def: Def = { name, key }
    this.defs.set(key, def)
    this.defsByName.set(name, def)
    this.createdDefs.push(def)
    return def
  }

  /**
   * Replaces a def nothing references yet by its schema, used inline.
   */
  inline(def: Def, schema: JsonSchema): void {
    this.remove(def)
    this.setAnonymous(def.key, schema)
  }

  /**
   * Replaces a def by another one (`{ $ref }`), freeing its name, when nothing refers to it:
   * neither its schema nor the defs created while it was converted.
   */
  replaceIfUnreferenced(def: Def, schema: JsonSchema): boolean {
    const later = this.createdDefs.slice(this.createdDefs.indexOf(def) + 1)

    if (
      collectDefRefs(def.schema ?? {}).has(def.name) ||
      later.some(
        (other) => other.schema === undefined || collectDefRefs(other.schema).has(def.name),
      )
    ) {
      return false
    }

    this.inline(def, schema)
    this.names.byKey.delete(def.key)
    this.names.used.delete(def.name)
    return true
  }

  setAnonymous(key: number, schema: JsonSchema): void {
    this.anonymous.set(key, schema)
    this.createdAnonymous.push(key)
  }

  /**
   * Keeps what the conversion added.
   */
  keepCreated(): void {
    this.createdDefs = []
    this.createdAnonymous = []
  }

  /**
   * Removes what the conversion added.
   */
  discardCreated(): void {
    for (const def of this.createdDefs) {
      this.remove(def)
      // it was emitted by the discarded conversion, a different schema must not take its name
      this.reservedNames.add(def.name)
    }
    for (const key of this.createdAnonymous) {
      this.anonymous.delete(key)
    }
    this.keepCreated()
  }

  /**
   * The schemas of the defs a schema references, also through other defs.
   */
  getReferencedDefs(schema: JsonSchema): Record<string, JsonSchema> {
    const $defs: Record<string, JsonSchema> = {}

    for (const name of this.collectDeps(collectDefRefs(schema))) {
      setOwn($defs, name, this.defsByName.get(name)!.schema!)
    }

    return $defs
  }

  /**
   * Inlines the root def, the defs of a root union, and the defs of `properties` of the root
   * (or of each root union member), unless they are recursive.
   */
  inlineRoot(schema: JsonSchema, properties: readonly string[]): JsonSchema {
    const inlineRef = (member: JsonSchema): JsonSchema => {
      const name = fromRef(member)
      const def = name === undefined ? undefined : this.defsByName.get(name)

      if (!def || this.collectDeps(this.getDeps(def)).has(def.name)) {
        return member
      }

      return def.schema!
    }

    const inlineProperties = (member: JsonSchema): JsonSchema => {
      const inlined = inlineRef(member)

      if (typeof inlined !== 'object' || !inlined.properties || !properties.length) {
        return inlined
      }

      const inlinedProperties = { ...inlined.properties }
      for (const property of properties) {
        if (inlinedProperties[property] !== undefined) {
          inlinedProperties[property] = inlineRef(inlinedProperties[property])
        }
      }

      return { ...inlined, properties: inlinedProperties }
    }

    const root = inlineProperties(schema)

    if (typeof root === 'object' && root.anyOf) {
      return { ...root, anyOf: root.anyOf.map(inlineProperties) }
    }

    return root
  }

  private remove(def: Def): void {
    this.defs.delete(def.key)
    this.defsByName.delete(def.name)
  }

  private getDeps(def: Def): Set<string> {
    // an unfinished def has no deps yet, and must not cache that
    if (def.schema === undefined) {
      return new Set()
    }

    def.deps ??= collectDefRefs(def.schema)
    return def.deps
  }

  /**
   * The defs reachable from the given ones, including them.
   */
  private collectDeps(names: Iterable<string>): Set<string> {
    const collected = new Set<string>()
    const queue = [...names]

    while (queue.length) {
      const name = queue.pop()!
      const def = this.defsByName.get(name)

      if (collected.has(name) || !def) {
        continue
      }

      collected.add(name)
      queue.push(...this.getDeps(def))
    }

    return collected
  }
}
