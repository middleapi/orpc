import type { Type } from 'typescript/unstable/sync'
import { ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import {
  extendsBuiltinClass,
  getBuiltinBaseName,
  getDeclaredBuiltinName,
  getNumberIndexType,
  getToJSON,
  hasBigIntToJSON,
  hasBuiltinForm,
  isBoxedBigInt,
  isModeSensitiveBuiltin,
  isTypedArray,
} from './builtins'
import { ExpansionGuard } from './expansion'
import { getClassType, getClassTypes, getDataProperties, isClassView } from './json-rules'
import type { TypeQueries } from './type-queries'
import { INSTANTIABLE_FLAGS, isObjectLiteral } from './type-queries'

/**
 * Whether types convert differently in another mode than under the serializer: when they reach
 * a `Set`, `Map`, `Blob`, `File`, or `bigint`, a built-in subclass serialized through its own
 * `toJSON`, or an object literal with `toJSON`. Class instances are always converted under
 * `JSON.stringify` rules, so they convert the same way in every mode.
 *
 * - `stringify`: under `JSON.stringify`. A view of a class (`Readonly<C>`) is converted in the
 *   `either` mode under the serializer, so it differs when its fields do, or when an instance
 *   differs from a plain object: `toJSON` (also of the class), getters, or a built-in base.
 * - `either`: when the value may be written by either one. A view is converted in the `either`
 *   mode under the serializer too, so it never differs.
 */
export class ModeSensitivity {
  private readonly cache = new Map<number, boolean>()
  /**
   * Results of the current walk that a cut expansion made not final, by the type and the
   * expansions around it, which decide where it is cut, so each is walked once per walk
   */
  private readonly walked = new Map<string, boolean>()
  /** Types on the current path, with their visit order, and whether they found a sensitive part */
  private readonly onPath = new Map<number, { order: number; sensitive: boolean }>()
  private readonly path: number[] = []
  private order = 0
  /** Infinitely expanding generics are cut, the converter cuts them too */
  private readonly expansion: ExpansionGuard

  constructor(
    private readonly types: TypeQueries,
    private readonly mode: 'stringify' | 'either',
  ) {
    this.expansion = new ExpansionGuard(types)
  }

  isSensitive(type: Type): boolean {
    try {
      return this.visit(type).sensitive
    } finally {
      this.walked.clear()
    }
  }

  /**
   * Types that refer to each other (a cycle) reach the same parts, so they share one answer,
   * decided once the first of them is done, like Tarjan's strongly connected components.
   * `low` is the earliest type on the path the visit came back to.
   */
  private visit(type: Type): { sensitive: boolean; low: number } {
    const cached = this.cache.get(type.id)

    if (cached !== undefined) {
      return { sensitive: cached, low: Infinity }
    }

    const walkKey = `${type.id}:${this.expansion.getContext()}`
    const walked = this.walked.get(walkKey)

    if (walked !== undefined) {
      return { sensitive: walked, low: Infinity }
    }

    const current = this.onPath.get(type.id)

    if (current !== undefined) {
      return { sensitive: current.sensitive, low: current.order }
    }

    const entry = { order: this.order++, sensitive: false }
    this.onPath.set(type.id, entry)
    this.path.push(type.id)

    let low = entry.order
    const cuts = this.expansion.cuts
    entry.sensitive =
      this.expansion.expand(type, () =>
        this.compute(type, (child) => {
          const result = this.visit(child)
          low = Math.min(low, result.low)
          return result.sensitive
        }),
      ) ?? false

    if (low < entry.order) {
      // part of a cycle that started earlier, its first type decides for all of them
      return { sensitive: entry.sensitive, low }
    }

    const members: number[] = []
    let sensitive = false

    for (let id = this.path.pop(); id !== undefined; id = this.path.pop()) {
      members.push(id)
      sensitive ||= this.onPath.get(id)!.sensitive
      if (id === type.id) {
        break
      }
    }

    // a cut hides what the expansion reaches further down, so only a sensitive part found is
    // final: the same type reached from elsewhere (or directly) is walked deeper. In the same
    // expansions, this walk reuses it, which keeps a DAG of types (`{ a: L; b: L }`) linear.
    const final = sensitive || cuts === this.expansion.cuts

    for (const id of members) {
      this.onPath.delete(id)
      if (final) {
        this.cache.set(id, sensitive)
      }
    }

    if (!final) {
      this.walked.set(walkKey, sensitive)
    }

    return { sensitive, low: Infinity }
  }

  private compute(type: Type, isSensitive: (type: Type) => boolean): boolean {
    const types = this.types
    const flags = type.flags

    // `JSON.stringify` throws on a bigint, unless `toJSON` is polyfilled, so the `either` mode
    // differs only through it
    if (flags & TypeFlags.BigIntLike) {
      return this.mode === 'stringify' || hasBigIntToJSON(types)
    }

    // the serializer leaves typed arrays, also with added fields, to `JSON.stringify`, but not
    // the plain object a view of a typed array class may hold (`Pick<class B extends Uint8Array, 's'>`)
    if (flags & (TypeFlags.Object | TypeFlags.Intersection) && isTypedArray(types, type)) {
      if (!isClassView(types, type)) {
        return false
      }
    }

    if (flags & TypeFlags.UnionOrIntersection) {
      const members = types.getMembers(type)

      // `JSON.stringify` calls `toJSON` of an array (`string[] & { toJSON(): number }`)
      if (
        flags & TypeFlags.Intersection &&
        members.some((m) => types.getReferenceKind(m) !== undefined) &&
        getToJSON(types, type)
      ) {
        return true
      }

      const classType = getClassType(types, type)

      // a class instance is converted the same way either way, a view (`C & { ... }`)
      // may also hold a plain object
      if (classType !== undefined) {
        // `MyMap & { x: string }` is written as a map or by `JSON.stringify`
        return (
          isModeSensitiveBuiltin(types, classType) ||
          (isClassView(types, type) && this.computeView(type, classType, isSensitive))
        )
      }

      return members.some(isSensitive)
    }

    if (flags & INSTANTIABLE_FLAGS) {
      const constraint = types.checker.getBaseConstraintOfType(type)
      return constraint !== undefined && constraint.id !== type.id && isSensitive(constraint)
    }

    if (!(flags & TypeFlags.Object)) {
      return false
    }

    if (types.getReferenceKind(type) !== undefined) {
      return types.getReferenceArguments(type).some(isSensitive)
    }

    // a built-in the serializer or `JSON.stringify` handles, not a library interface
    // holding data (`PromiseFulfilledResult<T>`)
    if (getDeclaredBuiltinName(types, type) !== undefined && hasBuiltinForm(types, type)) {
      // the serializer converts a boxed `BigInt` in the `either` mode already
      return (
        isModeSensitiveBuiltin(types, type) &&
        !(this.mode === 'either' && isBoxedBigInt(types, type))
      )
    }

    const symbol = type.getSymbol()
    const classType = getClassType(types, type)
    // the class, or an interface extending a built-in (`interface Tags extends Set<string>`)
    const declared =
      classType ?? (symbol && symbol.flags & SymbolFlags.Interface ? type : undefined)
    const extended = declared && getBuiltinBaseName(types, declared)

    // the serializer converts a view in the `either` mode, also an interface extending a built-in
    // class (`interface AppError extends Error`), unless it is a built-in
    // (`Readonly<class Tags extends Set<string>>`)
    if (
      this.mode === 'either' &&
      (classType !== undefined ? isClassView(types, type) : extendsBuiltinClass(types, type)) &&
      !hasBuiltinForm(types, type)
    ) {
      return false
    }

    // also an interface extending a view of a built-in (`interface Sized extends Pick<Set<T>, 'size'>`)
    if (declared !== undefined && isModeSensitiveBuiltin(types, declared)) {
      return true
    }

    // `class Rows extends Array<Set<string>>` is an array of its items
    if (extended === 'Array' || extended === 'ReadonlyArray') {
      const item = getNumberIndexType(types, type)
      return item !== undefined && isSensitive(item)
    }

    // class instances are converted under `JSON.stringify` rules either way, views may also
    // hold plain objects
    if (classType !== undefined) {
      return isClassView(types, type) && this.computeView(type, classType, isSensitive)
    }

    // a view of a built-in (`Pick<Set<string>, 'size'>`), also when it keeps too few members
    // to tell the built-in by them
    if ((type as any).objectFlags & ObjectFlags.Mapped && hasBuiltinForm(types, type)) {
      return isModeSensitiveBuiltin(types, type)
    }

    const properties = types.getProperties(type)
    const hasToJSON = properties.some((p) => p.name === 'toJSON')

    // the serializer skips `toJSON` of plain objects, `JSON.stringify` calls it. An object literal
    // is a plain object, a declared object type (`interface Point { toJSON(): string }`) may be
    // one, so the serializer writes what `toJSON` returns or its fields, the `either` mode too.
    if (hasToJSON) {
      return (
        this.mode === 'stringify' || isObjectLiteral(type) || this.computeFields(type, isSensitive)
      )
    }

    return this.computeFields(type, isSensitive)
  }

  /**
   * Whether a view of a class converts differently: never between the serializer and the
   * `either` mode (the serializer converts it in that mode), and under `JSON.stringify`, which
   * converts it as an instance, when a plain object differs from an instance (`toJSON` of the
   * view or of its class, getters, members inherited from a built-in, a built-in base), or its
   * fields do.
   */
  private computeView(type: Type, classType: Type, isSensitive: (type: Type) => boolean): boolean {
    const types = this.types

    if (this.mode === 'either') {
      return false
    }

    if (getClassTypes(types, type).some((c) => getToJSON(types, c) || hasBuiltinForm(types, c))) {
      return true
    }

    const properties = types.getProperties(type)

    return (
      properties.some((p) => p.name === 'toJSON') ||
      getDataProperties(types, properties, undefined, true).length !==
        getDataProperties(types, properties, classType).length ||
      this.computeFields(type, isSensitive)
    )
  }

  /**
   * Whether the fields of a type convert differently.
   */
  private computeFields(type: Type, isSensitive: (type: Type) => boolean): boolean {
    const types = this.types
    const properties = types.getProperties(type)
    const data = properties.filter((p) => !(p.flags & (SymbolFlags.Method | SymbolFlags.Prototype)))
    const dataTypes = types.getSymbolTypes(data)

    return (
      dataTypes.some((t) => t !== undefined && isSensitive(t)) ||
      types.checker.getIndexInfosOfType(type).some((info) => isSensitive(info.valueType))
    )
  }
}
