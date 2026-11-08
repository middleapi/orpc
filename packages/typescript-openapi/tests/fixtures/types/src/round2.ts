export type Maybe<T> = T | null
export interface L1 {
  id: string
  next: Maybe<L2>
}
export interface L2 {
  id: string
  next: Maybe<L3>
}
export interface L3 {
  id: string
  next: Maybe<L4>
}
export interface L4 {
  id: string
  next: Maybe<L5>
}
export interface L5 {
  id: string
  next: Maybe<L6>
}
export interface L6 {
  id: string
  next: Maybe<L7>
}
export interface L7 {
  id: string
  leaf: number
}

export type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> }
export type PartialConfig = DeepPartial<{ a: { b: { c: { d: { e: { f: { g: string } } } } } } }>

export type Expand<T> = { value: T; next?: Expand<T[]> }
export type Expanded = Expand<string>

export interface FnProp {
  name: string
  cb: Function
  ctor: new () => object
  hybrid: { (): void; displayName: string }
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  data: Object
}

export class DefaultMap<K, V> extends Map<K, V> {
  fallback?: V
}
export class Tags extends Set<string> {}
export class Stack extends Array<number> {}
export class MyError extends Error {
  code = 1
}
export interface LibraryClasses {
  map: DefaultMap<string, number>
  tags: Tags
  stack: Stack
  error: MyError
  plainError: Error
  bytes: Uint8Array
}

export type NumberIndexFirst = { [k: number]: number; [k: string]: string | number }

export type Message = `Error: ${string}`

export enum E {
  A = 'a',
  B = 'b',
}
export type DuplicateLiterals = E.A | 'a' | 'c'

export interface A {
  a: number
}
export interface B {
  b: string
}
export interface Page<T> {
  items: T[]
}
export interface Pair<T> {
  pair: T
}
export interface GenericNames {
  a: Page<A[]>
  b: Page<B[]>
  pair: Pair<[A, B]>
}

/**
 * An integer count
 * @type integer
 * @minimum 0
 */
export type Count = number
/** @format email */
export type Email = string
export interface PrimitiveAliases {
  count: Count
  email?: Email | null
  /** Own description wins */
  described: Count
}

/** The only kind */
export enum Kind {
  Only = 'only',
}
export interface UsesKind {
  kind: Kind
}

/**
 * A documented tree
 * @deprecated
 */
export interface DocTree {
  children: DocTree[]
}
/** A plain item */
export interface Plain {
  id: string
}
export interface RecursiveHolder {
  tree: DocTree
  plain: Plain
}
