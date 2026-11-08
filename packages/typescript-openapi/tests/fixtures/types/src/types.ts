import type { Except, LiteralUnion, PartialDeep, SetOptional, Simplify, Tagged } from 'type-fest'

import type { User } from '@/shared/user'

// primitives
export type Str = string
export type Num = number
export type Bool = boolean
export type Big = bigint
export type Null = null
export type Undef = undefined
export type Unknown = unknown
export type Any = any
export type Never = never
export type Obj = object
export type Sym = symbol

// literals
export type StrLit = 'a'
export type NumLit = -1.5
export type BoolLit = true
export type BigLit = 10n
export type StrUnion = 'a' | 'b' | 'c'
export type NumUnion = 1 | 2 | 3
export type Mixed = 'a' | 1 | true | null
export type Nullable = string | null
export type Optional = string | undefined
export type NullOrUndefined = null | undefined
export type LooseLiteral = LiteralUnion<'small' | 'large', string>
export type StringOrLiteral = 'a' | (string & {})

// enums
export enum Color {
  Red = 'red',
  Green = 'green',
}
export enum Level {
  Low,
  High = 10,
}
export enum MixedEnum {
  A = 'a',
  B = 1,
}
export type OnlyRed = Color.Red

// objects
export interface Basic {
  /** Required string */
  'required': string
  'optional'?: number
  'orUndefined': number | undefined
  'orNull': string | null
  'nullish'?: string | null
  readonly 'ro': boolean
  'quoted-key': string
  0: string
  'unknownValue': unknown
  'alwaysUndefined': undefined
  'fn': () => void
  'method'(): void
  'sym': symbol
}

export type Inline = { a: string; nested: { b: number[] } }
export type Empty = {}
export type EmptyRecord = Record<string, never>
export type Dict = Record<string, number>
export type NumDict = { [index: number]: string }
export type PrefixedDict = Record<`x-${string}`, string>
export type KeyedRecord = Record<'a' | 'b', number>
export type DictWithProps = { known: string; [key: string]: string }

// arrays & tuples
export type Arr = string[]
export type ReadonlyArr = readonly number[]
export type ArrOfUnion = (string | number)[]
export type ArrWithUndefined = (string | undefined)[]
export type Tuple = [string, number]
export type NamedTuple = [name: string, age?: number]
export type RestTuple = [string, ...boolean[]]
export type ReadonlyTuple = readonly [1, 2]
export type EmptyTuple = []

// unions & intersections
export type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; size: number }
export type Merged = { a: string } & { b?: number }
export type Branded = string & { readonly __brand: 'UserId' }
export type TaggedId = Tagged<string, 'UserId'>
export type ObjectOrArray = { a: string } | string[]

// template literals
export type Template = `user-${number}`
export type TemplateMulti = `${'GET' | 'POST'} /${string}`
export type TemplateBool = `is-${boolean}`
export type Upper = Uppercase<string>

// builtins
export interface Builtins {
  date: Date
  url: URL
  big: bigint
  set: Set<string>
  map: Map<string, number>
  blob: Blob
  file: File
  promise: Promise<string>
  regexp: RegExp
}

// classes
export class Point {
  x = 0
  y = 0
  #secret = 1
  private hidden = 2
  move(): number {
    return this.#secret
  }
}
export class Money {
  constructor(private readonly cents: number) {}
  toJSON(): string {
    return String(this.cents)
  }
}

// generics, mapped, conditional
export interface Box<T> {
  value: T
}
export type Page<T> = { items: T[]; total: number }
export type BoxOfUser = Box<User>
export type PageOfBox = Page<Box<number>>
export type PartialUser = Partial<User>
export type PickUser = Pick<User, 'id'>
export type OmitUser = Omit<User, 'id'>
export type RequiredUser = Required<{ a?: string }>
export type ReadonlyUser = Readonly<User>
export type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] }
export type Nullify<T> = { [K in keyof T]: T[K] | null }
export type NullifiedUser = Nullify<User>
export type IsString<T> = T extends string ? 'yes' : 'no'
export type Conditional = IsString<'a'>
export type Distributed = IsString<'a' | 1>
export type Indexed = User['name']
export type KeyOf = keyof User
export type ValueOf = Basic[keyof Pick<Basic, 'required' | 'optional'>]
export type Awaited1 = Awaited<Promise<Promise<number>>>
export type Returned = ReturnType<() => { ok: true }>
export type Extracted = Extract<Shape, { kind: 'circle' }>
export type Excluded = Exclude<StrUnion, 'a'>
export type NonNull = NonNullable<string | null | undefined>

// type-fest
export type Simplified = Simplify<{ a: string } & { b: number }>
export type DeepPartial = PartialDeep<{ a: { b: string } }>
export type SetOpt = SetOptional<{ a: string; b: number }, 'b'>
export type Excepted = Except<User, 'name'>

// recursion
export interface TreeNode {
  value: number
  children: TreeNode[]
}
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type LinkedList<T> = { value: T; next?: LinkedList<T> }
export type NumberList = LinkedList<number>
export interface A {
  b?: B
}
export interface B {
  a?: A
}

// jsdoc
export interface Documented {
  /**
   * The age in years
   * @minimum 0
   * @maximum 150
   * @default 18
   */
  age: number
  /**
   * @format email
   * @example "a@b.c"
   */
  email: string
  /** @deprecated use email */
  mail?: string
  /** @type integer */
  count: number
  /** @pattern ^[a-z]+$ */
  slug: string
  /** Refers a user */
  user: User
}
