import type { JsonSchema } from '@orpc/json-schema'
import { setOwn, stringifyJSON } from '@orpc/shared'

import { collectDefRefs, fromRef, objectMembers, toRef, withoutRequired } from './schema-utils'

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

/** Keys of values sent as parameters come after the keys of the modes, see `toParameterKey` */
const PARAMETER_KEY_OFFSET = 2 ** 42

/**
 * The conversion key of a value sent as a parameter (in the query string or the path), which the
 * bracket notation sends without the serializer's forms of some built-ins.
 */
export function toParameterKey(key: number): number {
  return key < 0 ? key - PARAMETER_KEY_OFFSET : key + PARAMETER_KEY_OFFSET
}

/**
 * The suffix of the def name of a parameter (see `toParameterKey`), after the one of its mode, so
 * its def does not take the name of the def of the value as a body. A def of it is named without
 * it when no other def has that name (see `mergeEquivalentComponents`).
 */
function getParameterSuffix(key: number): string {
  return Math.abs(key) >= PARAMETER_KEY_OFFSET ? 'Param' : ''
}

/** The conversion key of a value not sent as a parameter */
function withoutParameterKey(key: number): number {
  return key <= -PARAMETER_KEY_OFFSET
    ? key + PARAMETER_KEY_OFFSET
    : key >= PARAMETER_KEY_OFFSET
      ? key - PARAMETER_KEY_OFFSET
      : key
}

/**
 * The suffix of the def name of a type in the mode of a key, so names do not depend on which
 * mode was converted first: `Json` under `JSON.stringify`, `Any` for either one.
 */
function getModeSuffix(key: number): string {
  const modeKey = withoutParameterKey(key)
  return modeKey < 0 ? 'Json' : modeKey >= EITHER_KEY_OFFSET ? 'Any' : ''
}

/** The type id of a conversion key */
function getTypeId(key: number): number {
  const modeKey = withoutParameterKey(key)
  return modeKey < 0
    ? -modeKey
    : modeKey >= EITHER_KEY_OFFSET
      ? modeKey - EITHER_KEY_OFFSET
      : modeKey
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
  /**
   * Names numbered after a name another def held, with that name (`Page2` of `Page`), and names
   * of a mode a def of the same type in another mode shared, with its shorter name (`PointJson`
   * of `Point`), see `DefRegistry.share`
   */
  readonly numbered = new Map<string, string>()
  /** Names of a type in a mode, with the name of the type without it (`PointJson` of `Point`) */
  readonly modes = new Map<string, string>()
  /** How many registries have a def of each name */
  private readonly holders = new Map<string, number>()

  /**
   * Records a def of a name in a registry.
   */
  hold(name: string): void {
    this.holders.set(name, (this.holders.get(name) ?? 0) + 1)
  }

  /**
   * Records a registry no longer has a def of a name, whose name stays given.
   */
  unhold(name: string): void {
    const count = (this.holders.get(name) ?? 1) - 1
    if (count > 0) {
      this.holders.set(name, count)
    } else {
      this.holders.delete(name)
    }
  }

  /**
   * Frees the name of a def a registry no longer has, unless another one has a def of it (a type
   * the registry of outputs shares the def of another mode of, which the one of inputs names the
   * same), also for the type it named.
   */
  release(name: string, key?: number): void {
    this.unhold(name)

    if (this.holders.has(name)) {
      return
    }

    this.used.delete(name)
    this.modes.delete(name)
    if (key !== undefined && this.byKey.get(key) === name) {
      this.byKey.delete(key)
    }
  }
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
      const modeName = `${preferredName}${getModeSuffix(key)}`
      const base = `${modeName}${getParameterSuffix(key)}`
      const unavailable = (candidate: string) => taken(candidate) || this.names.used.has(candidate)
      // `Page_1` and `Page_12` must not collide as `Page_12`
      const separator = /\d$/u.test(base) ? '_' : ''
      name = base
      for (let i = 2; unavailable(name); i++) {
        name = `${base}${separator}${i}`
      }

      this.names.byKey.set(key, name)
      this.names.used.add(name)
      if (name !== modeName) {
        this.names.numbered.set(name, modeName)
      }
      if (base !== preferredName) {
        this.names.modes.set(name, preferredName)
      }
    }

    const def: Def = { name, key }
    this.defs.set(key, def)
    this.defsByName.set(name, def)
    this.names.hold(name)
    this.createdDefs.push(def)
    return def
  }

  /**
   * Gives a finished def the name a discarded conversion emitted for the same schema
   * (a type next to a cut expansion, converted again), instead of a numbered one.
   */
  reclaimName(def: Def, preferredName: string): void {
    const modeName = `${preferredName}${getModeSuffix(def.key)}`
    const name = `${modeName}${getParameterSuffix(def.key)}`

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
    this.names.release(def.name)
    def.name = name
    this.defsByName.set(name, def)
    this.names.hold(name)
    this.names.byKey.set(def.key, name)
    this.names.used.add(name)
    if (name !== modeName) {
      this.names.numbered.set(name, modeName)
    }
    if (modeName !== preferredName) {
      this.names.modes.set(name, preferredName)
    }
  }

  /**
   * Replaces a def nothing references yet by its schema, used inline.
   */
  inline(def: Def, schema: JsonSchema): void {
    this.remove(def)
    this.setAnonymous(def.key, schema, def.stable)
  }

  /**
   * Replaces a def by another one (`{ $ref }`), freeing its name unless the other registry of
   * the program has a def of it, when nothing refers to it: neither its schema nor the defs
   * created while it was converted.
   */
  replaceIfUnreferenced(def: Def, schema: JsonSchema): boolean {
    if (this.isReferenced(def)) {
      return false
    }

    this.defs.delete(def.key)
    this.defsByName.delete(def.name)
    this.names.release(def.name, def.key)
    this.setAnonymous(def.key, schema, def.stable)
    return true
  }

  /**
   * The live def of the same group with the same schema, replacing this finished def when nothing
   * refers to it yet; otherwise this def, which later ones of the group and schema share.
   * A type converted the same in two modes is named by the shorter name of its modes
   * (`Point` over `PointJson`), whichever comes first: the def kept takes it once no component
   * has it (see `mergeEquivalentComponents`).
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
      const preferred = this.names.numbered.get(existing.name) ?? existing.name
      if (getTypeId(def.key) === getTypeId(existing.key) && def.name.length < preferred.length) {
        this.names.numbered.set(existing.name, def.name)
      }
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

  /**
   * Whether a schema refers to a def being converted, also through finished defs, which the type it
   * describes is then in a cycle with.
   */
  refersToConverting(schema: JsonSchema): boolean {
    return [...this.collectDeps(collectDefRefs(schema))].some((name) => {
      const def = this.defsByName.get(name)
      return def !== undefined && def.schema === undefined
    })
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
   * (or of each root union member), unless they are recursive. Their parts are read by their
   * fields, so only the members a client sends the fields of are kept, also of the defs they
   * refer to. The fields of `partialProperties` are sent each on their own, so when one of
   * them may be missing, so may each of its fields.
   */
  inlineRoot(
    schema: JsonSchema,
    properties: readonly string[],
    partialProperties: readonly string[] = [],
  ): JsonSchema {
    const resolve = (member: JsonSchema): JsonSchema | undefined => {
      const name = fromRef(member)
      const def = name === undefined ? undefined : this.defsByName.get(name)

      return !def || this.collectDeps(this.getDeps(def)).has(def.name) ? undefined : def.schema!
    }

    const inlineRef = (member: JsonSchema): JsonSchema =>
      objectMembers(resolve(member) ?? member, resolve)

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

    let root = inlineProperties(schema)

    if (typeof root === 'object' && root.anyOf) {
      root = objectMembers({ ...root, anyOf: root.anyOf.map(inlineProperties) }, resolve)
    }

    const members = typeof root === 'object' ? (root.anyOf ?? [root]) : []
    const partial = partialProperties.filter((property) =>
      members.some(
        (m) => typeof m === 'object' && m.$ref === undefined && !m.required?.includes(property),
      ),
    )

    if (!partial.length) {
      return root
    }

    const withPartial = (member: JsonSchema): JsonSchema => {
      if (typeof member !== 'object' || !member.properties) {
        return member
      }

      const memberProperties = { ...member.properties }
      for (const property of partial) {
        if (memberProperties[property] !== undefined) {
          memberProperties[property] = withoutRequired(memberProperties[property])
        }
      }

      return { ...member, properties: memberProperties }
    }

    return typeof root === 'object' && root.anyOf
      ? { ...root, anyOf: root.anyOf.map(withPartial) }
      : withPartial(root)
  }

  /**
   * The JSON of a def's schema.
   */
  stringify(schema: JsonSchema): string {
    return stringifyJSON(schema)!
  }

  /**
   * Removes a def, whose name stays given (see `discardCreated`).
   */
  private remove(def: Def): void {
    this.defs.delete(def.key)
    this.defsByName.delete(def.name)
    this.names.unhold(def.name)
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
