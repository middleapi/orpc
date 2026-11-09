import type { JsonSchema } from '@orpc/json-schema'
import { setOwn, stringifyJSON } from '@orpc/shared'

import { collectDefRefs, fromRef, toRef } from './schema-utils'

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
  /** Whether no expansion was cut while converting it, so it does not depend on where it started */
  stable?: boolean
}

/**
 * Def names shared by the registries of one program (the converters for inputs and outputs),
 * so a type gets the same name in both.
 */
export class DefNames {
  readonly byKey = new Map<number, string>()
  readonly used = new Set<string>()
  /** Names numbered after a name another def held, with that name (`Page2` of `Page`) */
  readonly numbered = new Map<string, string>()
}

/**
 * The defs and shared results of the conversions, by the conversion key of their type.
 * What a conversion adds can be discarded, when it failed or depends on where it started.
 */
export class DefRegistry {
  private readonly defs = new Map<number, Def>()
  private readonly defsByName = new Map<string, Def>()
  /** Names emitted by discarded conversions, with the schema they were emitted with */
  private readonly reservedNames = new Map<string, JsonSchema | undefined>()
  /**
   * Finished conversions of anonymous types, shared between their uses,
   * and of named types whose schema is clearer inline, like `type UserId = string & { ... }`
   */
  private readonly anonymous = new Map<number, JsonSchema>()
  /** Finished defs by their group and schema, see `share` */
  private readonly shared = new Map<string, Def>()

  private createdDefs: Def[] = []
  /** Anonymous results the conversion added, with whether they are stable (see `Def.stable`) */
  private createdAnonymous: { key: number; stable: boolean }[] = []

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

  constructor(private readonly names: DefNames) {}

  create(key: number, preferredName: string): Def {
    const taken = (name: string) => this.defsByName.has(name) || this.reservedNames.has(name)
    let name = this.names.byKey.get(key)

    if (name === undefined || taken(name)) {
      const base = `${preferredName}${getModeSuffix(key)}`
      const unavailable = (candidate: string) => taken(candidate) || this.names.used.has(candidate)
      // `Page_1` and `Page_12` must not collide as `Page_12`
      const separator = /\d$/u.test(base) ? '_' : ''
      name = base
      for (let i = 2; unavailable(name); i++) {
        name = `${base}${separator}${i}`
      }

      this.names.byKey.set(key, name)
      this.names.used.add(name)
      if (name !== base) {
        this.names.numbered.set(name, base)
      }
    }

    const def: Def = { name, key }
    this.defs.set(key, def)
    this.defsByName.set(name, def)
    this.createdDefs.push(def)
    return def
  }

  /**
   * Gives a finished def the name a discarded conversion emitted for the same schema
   * (a type next to a cut expansion, converted again), instead of a numbered one.
   */
  reclaimName(def: Def, preferredName: string): void {
    const name = `${preferredName}${getModeSuffix(def.key)}`

    const reserved = this.reservedNames.get(name)

    if (
      def.name === name ||
      def.schema === undefined ||
      reserved === undefined ||
      this.defsByName.has(name) ||
      this.stringify(reserved) !== this.stringify(def.schema) ||
      this.isReferenced(def)
    ) {
      return
    }

    this.defsByName.delete(def.name)
    this.names.used.delete(def.name)
    def.name = name
    this.defsByName.set(name, def)
    this.names.byKey.set(def.key, name)
    this.names.used.add(name)
  }

  /**
   * Replaces a def nothing references yet by its schema, used inline.
   */
  inline(def: Def, schema: JsonSchema): void {
    this.remove(def)
    this.setAnonymous(def.key, schema, def.stable)
  }

  /**
   * Replaces a def by another one (`{ $ref }`), freeing its name, when nothing refers to it:
   * neither its schema nor the defs created while it was converted.
   */
  replaceIfUnreferenced(def: Def, schema: JsonSchema): boolean {
    if (this.isReferenced(def)) {
      return false
    }

    this.inline(def, schema)
    this.names.byKey.delete(def.key)
    this.names.used.delete(def.name)
    return true
  }

  /**
   * The live def of the same group with the same schema, replacing this finished def when nothing
   * refers to it yet; otherwise this def, which later ones of the group and schema share.
   */
  share(def: Def, group: string): Def {
    const signature = `${group}:${this.stringify(def.schema!)}`
    const existing = this.shared.get(signature)

    if (
      existing &&
      existing.key !== def.key &&
      this.defs.get(existing.key)?.name === existing.name &&
      this.replaceIfUnreferenced(def, { $ref: toRef(existing.name) })
    ) {
      return existing
    }

    this.shared.set(signature, def)
    return def
  }

  /**
   * Whether its schema or the defs created while it was converted may refer to a def.
   */
  private isReferenced(def: Def): boolean {
    const later = this.createdDefs.slice(this.createdDefs.indexOf(def) + 1)

    return (
      this.getDeps(def).has(def.name) ||
      later.some((other) => other.schema === undefined || this.getDeps(other).has(def.name))
    )
  }

  setAnonymous(key: number, schema: JsonSchema, stable = true): void {
    this.anonymous.set(key, schema)
    this.createdAnonymous.push({ key, stable })
  }

  /**
   * Keeps what the conversion added.
   */
  keepCreated(): void {
    this.createdDefs = []
    this.createdAnonymous = []
  }

  /**
   * Removes what the conversion added, or with `keepStable`, only what depends on where it started:
   * a stable def or result (see `Def.stable`) that refers only to kept defs is kept, so a type
   * next to a cut expansion keeps its def and name (an enum `E` next to `Expand<T>`).
   */
  discardCreated(keepStable = false): void {
    const created = new Set(this.createdDefs.map((def) => def.name))
    const kept = new Set(
      keepStable
        ? this.createdDefs
            .filter((def) => def.stable && this.defs.get(def.key) === def)
            .map((def) => def.name)
        : [],
    )
    const refersToDiscarded = (schema: JsonSchema) =>
      [...collectDefRefs(schema)].some((name) => created.has(name) && !kept.has(name))

    // until no kept def refers to a discarded one
    for (let changed = true; changed;) {
      changed = false
      for (const name of kept) {
        if (refersToDiscarded(this.defsByName.get(name)!.schema!)) {
          kept.delete(name)
          changed = true
        }
      }
    }

    for (const def of this.createdDefs) {
      if (!kept.has(def.name)) {
        this.remove(def)
        // it was emitted by the discarded conversion, a different schema must not take its name
        this.reservedNames.set(def.name, def.schema)
      }
    }
    for (const { key, stable } of this.createdAnonymous) {
      const schema = this.anonymous.get(key)
      if (!keepStable || !stable || schema === undefined || refersToDiscarded(schema)) {
        this.anonymous.delete(key)
      }
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

  /**
   * The JSON of a def's schema.
   */
  stringify(schema: JsonSchema): string {
    return stringifyJSON(schema)!
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
