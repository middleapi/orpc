// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import type { Simplify } from 'type-fest'

/** Expands each value again, which over a cycle beside another field never comes back */
type Expanding<T> = T extends object ? { [K in keyof T]: Expanding<T[K]> } : T

/** A model holding an expanding view of itself, beside an object literal field */
export interface ExpandingCycle {
  f0: Expanding<ExpandingCycle> | null
  f2: { a: number }
}

export enum Shade {
  Light = 'light',
  Dark = 'dark',
}

export enum Rank {
  Low = 1,
  High = 2,
}

export type FlagBrand = boolean & { __brand: 'FlagBrand' }
export type LiteralBrand = 'lit' & { __brand: 'LiteralBrand' }
export type TemplateBrand = `id-${number}` & { __brand: 'TemplateBrand' }
export type SymbolBrand = symbol & { __brand: 'SymbolBrand' }
export type TextBrand = string & { __brand: 'TextBrand' }

/** Each value, read-only, deeply, also of primitives through their members */
type ConditionalDeep<T> = T extends object ? { readonly [K in keyof T]: ConditionalDeep<T[K]> } : T

/** A model of plain fields */
export interface KeyedFields {
  a: number
}

/** An interface of methods only, which a `Set` satisfies */
export interface Lookup {
  has(key: string): boolean
}

/** A class without members, which any value but `null` and `undefined` satisfies */
// oxlint-disable-next-line typescript/no-extraneous-class
export class EmptyClass {}

/** An item of number-indexed records */
export interface IndexedItem {
  id: number
}

/** @type integer */
export type Count = number

/** Counts, also besides other types */
export interface CountedValues {
  c: Count
  d: Count | string
}

/** Each value, or a string */
export type Loose<T> = { [K in keyof T]: T[K] | string }

/** An item of sets, written as an object */
export interface SetItem {
  id: number
}

/** A class written by its `toJSON` */
export class CentsAmount {
  cents = 1

  toJSON(): string {
    return `${this.cents}c`
  }
}

/** A class with a `Set` field, which `JSON.stringify` writes as `{}` */
export class SetFieldHolder {
  tags = new Set(['a'])
}

/** Any object, an array or a function too */
export type AnyRecord = Record<string, any>

/** Strings, as an array, a set, or a string */
export type StringIterable = Iterable<string>

const symbolValue = Symbol('s')
const brandedSymbol = symbolValue as SymbolBrand
const text = 'x' as TextBrand

/**
 * Cycles through expanding generics, index signatures of `any`, views of unions of primitives
 * and of branded literals, number-indexed and method-only types, keyless intersections,
 * sets of values written alike, and aliases in unions.
 */
export const roundThirtyFive = {
  expandingCycle: os.handler((): ExpandingCycle => ({ f0: null, f2: { a: 1 } })),
  anyRecords: os.handler(
    (): {
      list: Record<string, any>
      date: Record<string, any>
      url: { [key: string]: any }
      set: Readonly<any>
      partial: Partial<any>
      fn: Readonly<any>
      record: Record<string, any>
    } => ({
      list: [1],
      date: new Date(0),
      url: new URL('http://a/'),
      set: new Set([1]),
      partial: [1],
      fn: () => 1,
      record: { a: 1 },
    }),
  ),
  literalUnionViews: os.handler(
    (): {
      shade: Omit<Shade, 'k'>
      letters: Omit<'a' | 'b', 'k'>
      template: Omit<`a${string}` | 'b', 'k'>
      rank: Omit<Rank, 'k'>
      digits: Omit<1 | 2, 'k'>
      flag: Omit<FlagBrand, '__brand'>
    } => ({
      shade: 'zz',
      letters: 'zz',
      template: 'zz',
      rank: 3,
      digits: 3,
      flag: true,
    }),
  ),
  brandedLiteralViews: os.handler(
    (): {
      literal: Omit<LiteralBrand, '__brand'>
      extended: Omit<LiteralBrand, '__brand' | 'length'> & { extra?: string }
      template: Omit<TemplateBrand, '__brand' | 'length'>
      nested: Omit<Omit<TemplateBrand, 'length'>, '__brand'>
    } => ({ literal: 'str', extended: 'str', template: 'str', nested: 'str' }),
  ),
  deepSymbolViews: os.handler(
    (): {
      deep: ConditionalDeep<SymbolBrand>
      list: ConditionalDeep<SymbolBrand>[]
      simplified: Simplify<SymbolBrand>
      literal: ConditionalDeep<symbol & { __b: 1 }>
      picked: ConditionalDeep<Pick<TextBrand, '__brand'>>
    } => ({
      deep: brandedSymbol,
      list: [brandedSymbol],
      simplified: brandedSymbol,
      literal: symbolValue as symbol & { __b: 1 },
      picked: text,
    }),
  ),
  omittedLengths: os.handler(
    (): {
      list: Omit<string[], 'length'>
      readonly: Omit<readonly string[], 'length'>
      tuple: Omit<[number, string], 'length'>
      maps: Omit<Map<string, number>[], 'length'>
    } => ({ list: ['a'], readonly: ['a'], tuple: [1, 'a'], maps: [new Map([['a', 1]])] }),
  ),
  keylessIntersections: os.handler(
    (): {
      list: object & { extra?: string }
      fn: object & { extra?: string }
      picked: Pick<KeyedFields, never> & { extra?: string }
      omitted: Omit<{ a: number }, 'a'> & { extra?: string }
    } => ({ list: [1], fn: () => 1, picked: 'str', omitted: 1 }),
  ),
  structuralTypes: os.handler(
    (): {
      iterable: Iterable<string>
      set: Iterable<string>
      entries: Iterable<[string, number]>
      chars: Iterable<string>
      ids: { ids: Iterable<number> }
      arrayLike: ArrayLike<number>
      numbered: Record<number, string>
      indexed: { [index: number]: IndexedItem }
      lookup: Lookup
      empty: EmptyClass
    } => ({
      iterable: ['a', 'b'],
      set: new Set(['a']),
      entries: new Map([['a', 1]]),
      chars: 'ab',
      ids: { ids: [1, 2] },
      arrayLike: [1, 2],
      numbered: ['a', 'b'],
      indexed: [{ id: 1 }],
      lookup: new Set(['a']),
      empty: 'x',
    }),
  ),
  arrayLikeRoot: os.handler((): ArrayLike<number> => [1, 2]),
  writtenAlike: os.handler(
    (): {
      dates: Set<Date>
      items: Set<SetItem>
      lists: Set<string[]>
      strings: Set<string>
    } => ({
      dates: new Set([new Date(0), new Date(0)]),
      items: new Set([{ id: 1 }, { id: 1 }]),
      lists: new Set([['a'], ['a']]),
      strings: new Set(['a', 'b']),
    }),
  ),
  counted: os.handler((): CountedValues => ({ c: 1, d: 'x' })),
  looseCounted: os.handler((): Loose<CountedValues> => ({ c: 'x', d: 'y' })),
}

/** Inputs of the same types, as a client sends them */
export const roundThirtyFiveInputs = {
  expandingCycle: os.input(type<ExpandingCycle>()).handler(() => 1),
  anyRecord: os.input(type<{ v: Record<string, any> }>()).handler(() => 1),
  primitiveView: os
    .input(type<{ v: ConditionalDeep<Pick<TextBrand, '__brand'>> }>())
    .handler(() => 1),
  omittedLength: os.input(type<{ v: Omit<number[][], 'length'> }>()).handler(() => 1),
  objectIntersection: os.input(type<{ v: object & { extra?: string } }>()).handler(() => 1),
  keylessIntersection: os
    .input(type<{ v: Pick<KeyedFields, never> & { extra?: string } }>())
    .handler(() => 1),
  iterable: os.input(type<{ ids: Iterable<string> }>()).handler(() => 1),
  arrayLike: os.input(type<{ ids: ArrayLike<number> }>()).handler(() => 1),
  numbered: os.input(type<{ ids: Record<number, string> }>()).handler(() => 1),
  moneyView: os.input(type<{ m: Readonly<CentsAmount> }>()).handler(() => 1),
  taggedView: os.input(type<{ t: Pick<SetFieldHolder, 'tags'> }>()).handler(() => 1),
}
