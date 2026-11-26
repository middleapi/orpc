export interface User {
  id: string
}
export interface UserProfile {
  bio: string
}
export interface Tag<T> {
  owner: T
  sub?: Tag<UserProfile>
}
export interface HolderTag {
  t: Tag<User>
}

export type Maybe<T> = T | null
export interface GUser {
  id: string
  friends: Maybe<GUser[]>
  best: Maybe<GUser>
}
export interface GQuery {
  me: Maybe<GUser>
}

export interface Widen<T> {
  value: T
  next: Widen<T | number> | null
}
export interface HolderWiden {
  w: Widen<string>
}

export type Grow<S extends string> = { v: S; a?: Grow<`${S}a`>; b?: Grow<`${S}b`> }
export interface HolderGrow {
  g: Grow<''>
}

/**
 * A name
 * @example "bob"
 */
export type Name = string & { __brand: 'Name' }
/** Always 42 */
export type Answer = 42
/**
 * A legacy status
 * @deprecated
 */
export type Legacy = 'old'
export interface AliasDocs {
  name: Name
  answer: Answer
  legacy: Legacy
}

export interface Person {
  name: string
  team?: Team
}
export interface Team {
  lead?: Person
  parent?: Team
}

export interface Tree {
  id: string
  children: Tree[]
}
export interface Forest {
  trees: Tree[]
}

export class MyDate extends Date {}
export class MyUrl extends URL {}
export interface Subclasses {
  date: MyDate
  url: MyUrl
}

export interface QA {
  kind: 'a'
  a: string
}
export interface QB {
  kind: 'b'
  b: string
}
export type QU = QA | QB
