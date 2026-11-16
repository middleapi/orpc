export interface KeywordTypes {
  /** @pattern [123] */
  b: string
  /** @pattern 123 */
  digits?: string
  /** @title 2024 */
  year?: string
  /** @format */
  a: string
  /** @maximum Infinity */
  inf?: number
  /** @minimum 1 */
  min: number
  /** @readOnly */
  ro: string
  /** @uniqueItems yes */
  list: string[]
  /** @default {"x": 1} */
  config?: object
}

export interface TemplateKeys {
  headers: Record<`x-${string}`, string>
  big: { [k: string]: number; [k: `x-${string}`]: 1 }
  mixed: { known: string; [k: `x-${string}`]: string }
}

export type Timestamps<T = Date> = Record<'createdAt' | 'updatedAt', T>
export type Versioned<T> = { [K in 'current' | 'previous']: T }
export type Pair<A, B> = { [K in 'left' | 'right']: K extends 'left' ? A : B }
export interface NotBuiltins {
  times: Timestamps
  at: Versioned<Date>
  pair: Pair<Set<string>, number>
}

export type Stringified<T> = { [K in keyof T]: string }
/** Mapped types changing the values of a built-in's members, whose values are plain objects */
export interface ValueMappedBuiltins {
  set: Stringified<Set<number>>
  map: { [K in keyof Map<string, number>]?: number }
}

export type ConditionalDeepPartial<T> = T extends object
  ? { [K in keyof T]?: ConditionalDeepPartial<T[K]> }
  : T
export class Account {
  id = ''
  greet(): string {
    return ''
  }
}
export interface MappedLookAlikes {
  params: URLSearchParams
  account: Account
  map: ReadonlyMap<string, number>
}
export type PartialLookAlikes = ConditionalDeepPartial<MappedLookAlikes>

export interface Page<T> {
  item: T
}
export type NumericPages = { a: Page<-1>; b: Page<1>; c: Page<12> }
