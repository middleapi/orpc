// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import type { FixedLengthArray, Simplify } from 'type-fest'

import type { MaybeExtra } from './view-intersections'
import type { OrList, OrString, StrTag } from './widened-views'
import { ValueBox } from './widened-views'

/** A pair whose elements and length may be missing */
export type PartialPair = Partial<[number, string] & MaybeExtra>

/** Values, or `null` */
export type OrNull<T> = { [K in keyof T]: T[K] | null }

/** Primitives instead of their literals */
export type Widen<T> = {
  [K in keyof T]: T[K] extends number ? number : T[K] extends string ? string : T[K]
}

/** Read-only all the way down, through a conditional type */
export type CDeep<T> = T extends object ? { readonly [K in keyof T]: CDeep<T[K]> } : T

export enum NumericKind {
  A = 1,
  B = 2,
}

export enum TextKind {
  A = 'a',
}

export class NumericKinded {
  e = NumericKind.A as NumericKind.A
  tags = new Set(['a'])
}

export class TextKinded {
  s = TextKind.A as TextKind.A
  tags = new Set(['a'])
}

export class TaggedUser {
  tags = new Set(['a'])
  id = 1
}

const extra = { x: 1 }
const taggedUser = () => Object.assign(new TaggedUser(), { x: 1 })

/** A class whose `toJSON` is one of two functions */
export class TwoResults {
  a = 1
  toJSON: (() => { x: string }) | (() => number) = () => 5
}

/** A class whose `toJSON` is one of two functions, one taking the key */
export class KeyedResult {
  a = 1
  toJSON: (() => string) | ((key: string) => { k: string }) = (key) => ({ k: key })
}

export class HoldsTwoResults {
  two = new TwoResults()
}

/** An object whose `toJSON` is one of two functions */
export interface TwoFunctions {
  a: number
  toJSON: (() => { x: number }) | (() => { y: string })
}

/** An object whose `toJSON` is a read-only view of the method */
export interface OnlyFrozen {
  a: number
  toJSON: Readonly<() => { w: string }>
}

/** An object whose `toJSON` is a string or a read-only view of the method */
export interface StrOrFrozen {
  a: number
  toJSON: string | Readonly<() => { w: string }>
}

/** A class whose `toJSON` is a read-only view of the method */
export class FrozenMethod {
  a = 1
  toJSON: Readonly<() => { w: string }> = () => ({ w: 'x' })
}

/** A class whose `toJSON` is a partial view of the method */
export class PartialMethod {
  a = 1
  toJSON: Partial<() => { w: string }> = () => ({ w: 'x' })
}

/** A class whose `toJSON` is any function */
export class AnyFunctionMethod {
  a = 1
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  toJSON: Function = () => ({ f: 1 })
}

/** A string of eight characters */
export type EightLong = string & { length: 8 }
/** A number whose value is one */
export type JustOne = number & { valueOf(): 1 }

export const arrayLikeViews = {
  // array-like views with an optional length may be arrays or plain objects
  partialArrays: os.handler(
    (): {
      empty: PartialPair
      extra: PartialPair
      pair: PartialPair
      fixed: Partial<FixedLengthArray<number, 2>>
      list: Partial<number[] & { x?: string }>
      rest: Partial<[number, ...string[]] & MaybeExtra>
    } => ({
      empty: {},
      extra: { extra: 'x' },
      pair: [1, 'a'],
      fixed: {},
      list: {},
      rest: {},
    }),
  ),
  partialArrayRoot: os.handler((): PartialPair => ({})),
  // a `toJSON` that is one of several functions writes what any of them returns
  toJSONUnions: os.handler(
    (): {
      two: TwoResults
      frozen: Readonly<TwoResults>
      holds: HoldsTwoResults
      list: TwoResults[]
      keyed: KeyedResult
      functions: ValueBox<TwoFunctions>
    } => ({
      two: new TwoResults(),
      frozen: new TwoResults(),
      holds: new HoldsTwoResults(),
      list: [new TwoResults()],
      keyed: new KeyedResult(),
      functions: new ValueBox<TwoFunctions>({ a: 1, toJSON: () => ({ y: 'y' }) }),
    }),
  ),
  toJSONUnionRoot: os.handler((): TwoResults => new TwoResults()),
  // views of a class intersected with a record or an object literal type
  recordViews: os.handler(
    (): {
      deepRecord: CDeep<TaggedUser & Record<'x', number>>
      deepLiteral: CDeep<TaggedUser & typeof extra>
      simpleRecord: Simplify<TaggedUser & Record<'x', number>>
      simpleLiteral: Simplify<TaggedUser & typeof extra>
    } => ({
      deepRecord: taggedUser(),
      deepLiteral: taggedUser(),
      simpleRecord: taggedUser(),
      simpleLiteral: taggedUser(),
    }),
  ),
  recordViewRoot: os.handler((): CDeep<TaggedUser & Record<'x', number>> => taggedUser()),
  // mapped types widening an enum literal are views
  widenedEnums: os.handler((): { numeric: Widen<NumericKinded>; text: Widen<TextKinded> } => ({
    numeric: new NumericKinded(),
    text: new TextKinded(),
  })),
  // a `toJSON` typed as a view of the method, or as any function, is called
  toJSONViews: os.handler(
    (): {
      only: ValueBox<OnlyFrozen>
      str: ValueBox<StrOrFrozen>
      strValue: ValueBox<StrOrFrozen>
      frozen: FrozenMethod
      partial: PartialMethod
      any: AnyFunctionMethod
    } => ({
      only: new ValueBox<OnlyFrozen>({ a: 1, toJSON: () => ({ w: 'x' }) }),
      str: new ValueBox<StrOrFrozen>({ a: 1, toJSON: () => ({ w: 'x' }) }),
      strValue: new ValueBox<StrOrFrozen>({ a: 1, toJSON: 'x' }),
      frozen: new FrozenMethod(),
      partial: new PartialMethod(),
      any: new AnyFunctionMethod(),
    }),
  ),
  frozenMethodRoot: os.handler((): FrozenMethod => new FrozenMethod()),
  // mapped types widening the values of an array intersected with an object
  widenedArrays: os.handler(
    (): {
      str: OrString<string[] & MaybeExtra>
      nulls: OrNull<string[] & MaybeExtra>
      list: OrList<[number] & MaybeExtra>
    } => ({ str: ['a'], nulls: ['a'], list: [1] }),
  ),
  widenedArrayRoot: os.handler((): OrString<string[] & MaybeExtra> => ['a']),
  // views of arrays and tuples leaving out `length` or `slice` still hold arrays
  pickedArrays: os.handler(
    (): {
      first: Pick<[number, string], 0>
      firstLength: Pick<[number, string], 0 | 'length'>
      noSlice: Omit<[number, string], 'slice'>
      listNoSlice: Omit<string[], 'slice'>
      listFirst: Pick<string[], 0 | 'length'>
      map: Pick<string[], 'map'>
    } => ({
      first: [1, 'a'],
      firstLength: [1, 'a'],
      noSlice: [1, 'a'],
      listNoSlice: ['a'],
      listFirst: ['a'],
      map: ['a'],
    }),
  ),
  pickedArrayRoot: os.handler((): Pick<[number, string], 0> => [1, 'a']),
  // views of primitives through `Omit`, or by the number index
  omittedPrimitives: os.handler(
    (): {
      str: Omit<string, 'k'>
      num: Omit<number, 'toFixed'>
      bool: Omit<boolean, 'k'>
      index: Pick<string, number>
    } => ({ str: 'a', num: 1, bool: true, index: 'a' }),
  ),
  // views of branded primitives intersected with an object type
  brandedViews: os.handler(
    (): {
      tag: Readonly<StrTag> & MaybeExtra
      eight: Partial<EightLong> & MaybeExtra
      one: Readonly<JustOne> & MaybeExtra
    } => ({ tag: 'tag' as StrTag, eight: 'abcdefgh' as EightLong, one: 1 as JustOne }),
  ),
  // `object` and `{}` also hold functions, which JSON leaves out
  objectFields: os.handler(
    // oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-wrapper-object-types
    (): { obj: object; empty: {}; boxed: Object; list: object[] } => ({
      obj: () => 1,
      empty: () => 1,
      boxed: () => 1,
      list: [() => 1],
    }),
  ),
}

/** Inputs of array-like views, views of primitives, and `object` */
export const arrayLikeViewsInputs = {
  partialPair: os.input(type<PartialPair>()).handler(() => 1),
  widenedArray: os.input(type<OrString<string[] & MaybeExtra>>()).handler(() => 1),
  pickedTuple: os.input(type<Pick<[number, string], 0>>()).handler(() => 1),
  omittedString: os.input(type<Omit<string, 'k'>>()).handler(() => 1),
  brandedView: os.input(type<Readonly<string & { __t: 1 }> & MaybeExtra>()).handler(() => 1),
  objectField: os.input(type<{ v: object }>()).handler(() => 1),
}
