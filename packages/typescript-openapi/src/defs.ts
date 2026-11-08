import type { JsonSchema } from '@orpc/json-schema'

import { collectDefRefs, fromRef } from './schema-utils.ts'

export interface Def {
  name: string
  /** The conversion key of the type */
  key: number
  schema?: JsonSchema
  /** The defs the schema refers to, computed once the schema is final */
  deps?: Set<string>
}

/**
 * The defs and shared results of the conversions, by the conversion key of their type.
 * What a conversion adds can be discarded, when it failed or depends on where it started.
 */
export class DefRegistry {
  private readonly defs = new Map<number, Def>()
  private readonly defsByName = new Map<string, Def>()
  /** Named types whose schema is clearer inline, like `type UserId = string & { ... }` */
  private readonly inlined = new Map<number, JsonSchema>()
  /** Finished conversions of anonymous types, shared between their uses */
  private readonly anonymous = new Map<number, JsonSchema>()

  private createdDefs: Def[] = []
  private createdInlined: number[] = []
  private createdAnonymous: number[] = []

  get(key: number): Def | undefined {
    return this.defs.get(key)
  }

  getInlined(key: number): JsonSchema | undefined {
    return this.inlined.get(key)
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

  create(key: number, preferredName: string): Def {
    // `Page_1` and `Page_12` must not collide as `Page_12`
    const separator = /\d$/u.test(preferredName) ? '_' : ''
    let name = preferredName
    for (let i = 2; this.defsByName.has(name); i++) {
      name = `${preferredName}${separator}${i}`
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
    this.inlined.set(def.key, schema)
    this.createdInlined.push(def.key)
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
    this.createdInlined = []
    this.createdAnonymous = []
  }

  /**
   * Removes what the conversion added.
   */
  discardCreated(): void {
    for (const def of this.createdDefs) {
      this.remove(def)
    }
    for (const key of this.createdInlined) {
      this.inlined.delete(key)
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
      $defs[name] = this.defsByName.get(name)!.schema!
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
