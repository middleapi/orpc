// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import type { Simplify } from 'type-fest'

import type { DeepRO, DeepReadonlyIf } from './deep-views'
import type { Item as FirstItem } from './same-named/one'
import type { Item as SecondItem } from './same-named/two'
import type { MaybeExtra, OrFrozen } from './view-intersections'

/** A string of eight characters */
export type EightChars = string & { length: 8 }
/** A number whose value is one */
export type ValueOne = number & { valueOf(): 1 }

const eight = 'abcdefgh' as EightChars
const one = 1 as ValueOne

export class SetHolder {
  tags = new Set(['a'])
  n = 1
}

/** A holder with the time of a date */
export type HolderTime = SetHolder & Pick<Date, 'getTime'>
/** A holder declared with the time of a date */
export interface HolderTimeView extends SetHolder, Pick<Date, 'getTime'> {}

const holderTime = () => Object.assign(new SetHolder(), { getTime: () => 1 })

export type StrTag = string & { __tag: 'S' }
/** Values, or strings */
export type OrString<T> = { [K in keyof T]: T[K] | string }
/** Values, or lists of them */
export type OrList<T> = { [K in keyof T]: T[K] | T[K][] }
/** Values, or values wrapped in an object */
export type OrWrapped<T> = { [K in keyof T]: T[K] | { wrapped: T[K] } }
/** Sets, or their items as an array */
export type SetOrItems<T> = { [K in keyof T]: T[K] extends Set<infer U> ? U[] | T[K] : T[K] }
/** Values, or deep views of them */
export type OrDeep<T> = { [K in keyof T]: T[K] | DeepRO<T[K]> }
/** Values or `null`, all the way down */
export type DeepOrNull<T> = T extends object ? { [K in keyof T]: DeepOrNull<T[K]> | null } : T
/** Values, or partial views of them */
export type OrPartial<T> = { [K in keyof T]: T[K] | Partial<T[K]> }
/** Mutable all the way down, keeping functions */
export type DeepMut<T> = T extends Function
  ? T
  : T extends object
    ? { -readonly [K in keyof T]: DeepMut<T[K]> }
    : T

const tag = (s: string) => s as StrTag

export class TagsOnly {
  tags = new Set(['a'])
}

export class WritesWord {
  w = 'x'
  n = 1

  toJSON(): { w: string } {
    return { w: this.w }
  }
}

type Constructor = new (...args: any[]) => object

export function Tagged<B extends Constructor>(Base: B) {
  return class extends Base {
    mtags = new Set(['m'])
  }
}

export class TaggedError extends Tagged(Error) {}
export class TaggedSet extends Tagged(Set<number>) {}
export class TaggedMap extends Tagged(Map<string, boolean>) {}
export class TaggedDate extends Tagged(Date) {}
export class TaggedURL extends Tagged(URL) {}

export interface WithWord {
  a: number
  toJSON(): { w: string }
}

const withWord = (): WithWord => ({ a: 1, toJSON: () => ({ w: 'x' }) })

export class ValueBox<T> {
  constructor(public value: T) {}
}

export class ErrorAndTags {
  e = new Error('x')
  tags = new Set(['a'])
}

export interface WithError {
  e: Error
}

export class ErrorDate extends Date {
  e = new Error('x')
}

export class SetWithJSON {
  v = new Set([1])

  toJSON(): { v: number[] } {
    return { v: [...this.v] }
  }
}

export class DateWithJSON extends Date {
  v = new Set([1])

  override toJSON(): any {
    return { v: [...this.v] }
  }
}

/** An object whose `toJSON` is the method or a read-only view of it, which may hold any value */
export interface FrozenJ {
  a: number
  toJSON: (() => { w: string }) | Readonly<() => { w: string }>
}

/** The same, with a deep read-only view of the method */
export interface DeepFrozenJ {
  a: number
  toJSON: (() => { w: string }) | DeepRO<() => { w: string }>
}

export interface PlainJ {
  a: number
  toJSON(): { j: string }
}

/** A class whose `toJSON` field is the method or a read-only view of it */
export class FrozenField {
  a = 1
  toJSON: (() => { w: string }) | Readonly<() => { w: string }> = 'x'
}

export const widenedMappedViews = {
  // brands redeclaring a member of the primitive's interface are still the primitive
  narrowedBrands: os.handler(
    (): {
      deep: DeepReadonlyIf<EightChars>
      simple: Simplify<EightChars>
      one: Simplify<ValueOne>
      deepOne: DeepReadonlyIf<ValueOne>
    } => ({ deep: eight, simple: eight, one, deepOne: one }),
  ),
  narrowedBrandRoot: os.handler((): Simplify<EightChars> => eight),
  // a class intersected with a view of a built-in may be an instance of the class
  holderTimes: os.handler(
    (): {
      time: HolderTime
      view: HolderTimeView
      deep: DeepReadonlyIf<HolderTimeView>
    } => ({ time: holderTime(), view: holderTime(), deep: holderTime() }),
  ),
  holderTimeRoot: os.handler((): HolderTime => holderTime()),
  // mapped types widening each value with other values are views
  widenedValues: os.handler(
    (): {
      str: OrString<StrTag>
      list: OrList<StrTag>
      date: OrList<Date & MaybeExtra>
      wrapped: OrWrapped<TagsOnly>
      items: SetOrItems<TagsOnly>
      word: OrList<WritesWord>
      error: SetOrItems<TaggedError>
    } => ({
      str: tag('x'),
      list: tag('x'),
      date: new Date(0),
      wrapped: new TagsOnly(),
      items: new TagsOnly(),
      word: new WritesWord(),
      error: new TaggedError('m'),
    }),
  ),
  // `toJSON` of a view widening it with a view of it is still called
  widenedToJSON: os.handler(
    (): {
      frozen: ValueBox<OrFrozen<WithWord>>
      partial: ValueBox<OrPartial<WithWord>>
    } => ({
      frozen: new ValueBox<OrFrozen<WithWord>>(withWord()),
      partial: new ValueBox<OrPartial<WithWord>>(withWord()),
    }),
  ),
  // a view of the method in `toJSON` may hold a value `JSON.stringify` does not call
  frozenToJSON: os.handler(
    (): {
      str: ValueBox<FrozenJ>
      obj: ValueBox<FrozenJ>
      called: ValueBox<FrozenJ>
      deep: ValueBox<DeepFrozenJ>
      plain: ValueBox<OrFrozen<PlainJ>>
      field: FrozenField
    } => ({
      str: new ValueBox<FrozenJ>({ a: 1, toJSON: 'x' }),
      obj: new ValueBox<FrozenJ>({ a: 1, toJSON: {} }),
      called: new ValueBox<FrozenJ>({ a: 1, toJSON: () => ({ w: 'x' }) }),
      deep: new ValueBox<DeepFrozenJ>({ a: 1, toJSON: 'x' }),
      plain: new ValueBox<OrFrozen<PlainJ>>({ a: 1, toJSON: 'x' }),
      field: new FrozenField(),
    }),
  ),
  frozenFieldRoot: os.handler((): FrozenField => new FrozenField()),
  // array-like views of tuples leaving out an element still hold it
  pickedTuples: os.handler(
    (): {
      inner: Pick<[number, string, boolean], 0 | 2 | 'length' | 'slice'>
      first: Pick<[number, string, boolean], 0 | 'length' | 'slice'>
      rest: Pick<[number, ...string[]], 0 | 'length' | 'slice'>
    } => ({ inner: [1, 'a', true], first: [1, 'a', true], rest: [1, 'a'] }),
  ),
  // classes extending a mixin applied to a built-in are built-in subclasses
  mixinBuiltins: os.handler(
    (): { set: TaggedSet; frozen: Readonly<TaggedSet>; map: TaggedMap } => ({
      set: new TaggedSet([1]),
      frozen: new TaggedSet([1]),
      map: new TaggedMap([['k', true]]),
    }),
  ),
  mixinSetRoot: os.handler((): TaggedSet => new TaggedSet([1])),
  // views of intersections of arrays and tuples with an object are arrays
  arrayViews: os.handler(
    (): {
      tuple: Readonly<[number, string?] & MaybeExtra>
      partial: Partial<number[] & MaybeExtra>
    } => ({ tuple: [1], partial: [1] }),
  ),
  // conditional deep views over values widened with deep views of them
  deepOrViews: os.handler(
    (): {
      deep: DeepReadonlyIf<OrDeep<ErrorAndTags>>
      nulls: DeepOrNull<OrDeep<ErrorAndTags>>
      date: DeepOrNull<OrDeep<Date & WithError>>
    } => ({ deep: new ErrorAndTags(), nulls: new ErrorAndTags(), date: new ErrorDate(0) }),
  ),
  // a conditional type keeping functions over a class with `toJSON` and a date
  mutableDate: os.handler((): { mutable: DeepMut<SetWithJSON & Date> } => ({
    mutable: new DateWithJSON(0),
  })),
  // `JSON.stringify` can not write bigints, also of typed arrays
  bigintArrays: os.handler((): { signed: BigInt64Array; unsigned: BigUint64Array } => ({
    signed: new BigInt64Array(),
    unsigned: new BigUint64Array(),
  })),
}

export class StampDate extends Date {
  label = 'x'
}

export class GetterOnly {
  n = 1

  get g(): number {
    return this.n
  }
}

/** Inputs of widened views, mixins applied to built-ins, and `URLSearchParams` */
export const widenedMappedViewsInputs = {
  orString: os.input(type<{ id: OrString<StrTag> }>()).handler(() => 1),
  orListStamp: os.input(type<{ at: OrList<StampDate> }>()).handler(() => 1),
  orListGetter: os.input(type<OrList<GetterOnly>>()).handler(() => 1),
  mixinDate: os.input(type<{ d: TaggedDate }>()).handler(() => 1),
  mixinURL: os.input(type<{ u: TaggedURL }>()).handler(() => 1),
  mixinSet: os.input(type<{ s: TaggedSet }>()).handler(() => 1),
  pickedMixinDate: os.input(type<{ d: Pick<TaggedDate, 'mtags'> }>()).handler(() => 1),
  params: os.input(type<{ p: URLSearchParams }>()).handler(() => 1),
}

/** Two declared types of one name, the second one numbered, the first one's def inlined */
export const numberedComponents = {
  first: os.route({ outputStructure: 'detailed' }).handler((): FirstItem => ({ id: 'x' })),
  second: os.handler(async (): Promise<{ i: SecondItem }> => ({ i: { name: 'x' } })),
}

/** The same, with the first one in a request body */
export const numberedBodyComponents = {
  first: os.input(type<{ x: FirstItem }>()).handler(() => 1),
  second: os.handler(async (): Promise<{ i: SecondItem }> => ({ i: { name: 'x' } })),
}
