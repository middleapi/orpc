/* oxlint-disable typescript/no-unnecessary-type-parameters -- the library type shapes under test */
import { os, type } from '@orpc/server'

const rows: { id: number }[] = []

export interface Paginated<T> {
  items: T[]
  nextCursor: number | null
}

type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never }
export type XOR<T, U> = T extends object
  ? U extends object
    ? ((Without<T, U> & U) | (Without<U, T> & T)) & object
    : U
  : T
export interface OA {
  a?: string
}
export interface OB {
  b?: number
}
export interface Filter {
  is?: Where
  isNot?: Where
}
export interface Where {
  AND?: Where[]
  id?: number
  author?: XOR<Filter, Where>
}
export interface Node {
  id: number
  next?: Node & object
}
export interface WeakNode {
  id?: number
  next?: WeakNode & object
}
export interface Defaults {
  result: { id: number }
}
export interface FindArgs<Ext extends object = Defaults> {
  take?: number
  ext?: Ext
}

interface Marker<P> {
  $m: P
}
export class Doc<T> {
  constructor(private data: T) {}
  toJSON<P>(this: Marker<P>): P & { populated: true }
  toJSON<O extends { virtuals?: boolean }>(o: O): T & { id: string }
  toJSON(o?: { virtuals?: boolean }): T & { _id: string }
  toJSON<X>(o?: { virtuals?: boolean }): X & { _id: string }
  toJSON(): unknown {
    return { ...this.data, _id: 'x' }
  }
}

export class Conn {
  host = 'h'
  pool: number[] = []
}
/** A document class, whose instances hold their fields, written by its `toJSON` */
export class HDoc<T> {
  db: Conn = new Conn()
  isNew = true
  toJSON(): T & { key: string } {
    const { db: _db, isNew: _isNew, ...fields } = this
    return { ...(fields as T), key: 'x' }
  }
}
export type Hydrated<T> = HDoc<T> & T

/** A document class inheriting its `toJSON` */
export class SubDoc<T> extends HDoc<T> {
  nested = true
}

/** A document whose `toJSON` holds documents, which `JSON.stringify` writes by their `toJSON` */
export class DocHolder {
  toJSON(): { docs: (SubDoc<{ street: string }> & { street: string })[] } {
    return { docs: [Object.assign(new SubDoc<{ street: string }>(), { street: 's' })] }
  }
}

type DeepPartial<T> =
  | T
  | (T extends Array<infer U>
      ? DeepPartial<U>[]
      : T extends object
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T)
export interface Post {
  id: number
  author: User
}
export interface User {
  id: string
  posts: Post[]
}

export class CUser {
  id = 'u'
  name = 'n'
  posts: CPost[] = []
}
export class CPost {
  id = 1
  author!: CUser
}

export class Svc {
  run(): number {
    return 1
  }
}
export declare class Stamp {
  format(): string
  toJSON(): string
}

/** A document whose `toJSON` has an overload for documents carrying a marker, like populated ones */
export class MarkedDoc {
  name = 'a'
  toJSON<P>(this: Marker<P>): { populated: P }
  toJSON(): { name: string }
  toJSON(): unknown {
    const { $m } = this as Partial<Marker<unknown>>
    return $m === undefined ? { name: this.name } : { populated: $m }
  }
}
export type Populated = MarkedDoc & Marker<{ id: number }>

/** A `toJSON` returning a conditional type left unresolved, which may hold the class again */
export class Looping {
  a = 1
  toJSON<K>(): K extends string ? Looping : number
  toJSON(): unknown {
    return 1
  }
}

/** Outputs the serialization oracle runs */
export const roundEighty = {
  // no row is sent as no body, written as `null`
  missingRow: os.handler(async (): Promise<{ id: number } | undefined> =>
    rows.find((r) => r.id === 1),
  ),
  // a value without its optional file is sent as JSON
  optionalBlob: os.handler((): { rows: number[]; blob?: Blob } => ({ rows: [1] })),
  looping: os.handler(() => ({ looping: new Looping() })),
  // written by the overload a call with the key or without arguments resolves to
  doc: os.handler(() => new Doc({ name: 'a' })),
  // an instance, not a plain object of the class's fields
  hydrated: os.handler((): Hydrated<{ name: string }> =>
    Object.assign(new HDoc<{ name: string }>(), { name: 'a' }),
  ),
  docHolder: os.handler(() => new DocHolder()),
  // the overload a value carrying the marker may call, also by the compiler
  markedDoc: os.handler(() => new MarkedDoc()),
  populated: os.handler((): Populated => Object.assign(new MarkedDoc(), { $m: { id: 1 } })),
}

export const roundEightyTypes = {
  posts: os.handler((): Paginated<{ id: number; title: string }> => ({
    items: [],
    nextCursor: null,
  })),
  accounts: os.handler((): Paginated<{ id: number; handle: string }> => ({
    items: [],
    nextCursor: null,
  })),
  objectOnly: os.input(type<{ a?: string } & object>()).handler(() => 1),
  optionalXor: os.input(type<XOR<OA, OB>>()).handler(() => 1),
  where: os.input(type<Where>()).handler(() => 1),
  node: os.input(type<Node>()).handler(() => 1),
  weakNode: os.input(type<WeakNode>()).handler(() => 1),
  findArgs: os.input(type<FindArgs>()).handler(() => 1),
  saveUser: os.input(type<DeepPartial<User>>()).handler(() => 1),
  savePost: os.input(type<DeepPartial<Post>>()).handler(() => 1),
  omit: os.input(type<Omit<CUser, 'id'>>()).handler(() => 1),
  pick: os.input(type<Pick<CUser, 'name' | 'posts'>>()).handler(() => 1),
  pickPosts: os.input(type<Pick<CUser, 'id' | 'posts'>>()).handler(() => 1),
  svc: os.handler(() => new Svc()),
  nested: os.handler(() => ({ svc: new Svc(), n: 1 })),
  stamp: os.input(type<{ at: Stamp }>()).handler(() => 1),
}
