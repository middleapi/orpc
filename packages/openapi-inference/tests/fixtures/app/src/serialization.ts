import { os, type } from '@orpc/server'
import type { FixedLengthArray, Jsonifiable, Tagged } from 'type-fest'
import * as z from 'zod'

import { roundTwentyFive } from './round25'
import { roundTwentySix } from './round26'
import { roundTwentySeven } from './round27'
import { roundTwentyEight } from './round28'
import { roundTwentyNine } from './round29'
import { roundThirty } from './round30'
import { roundThirtyOne } from './round31'
import { roundThirtyTwo } from './round32'
import { roundThirtyThree } from './round33'
import { roundThirtyFive } from './round35'
import { roundThirtySix } from './round36'
import { roundThirtySeven } from './round37'
import { roundThirtyNine } from './round39'
import { roundFortyTwo } from './round42'
import { roundFortyFour } from './round44'
import { roundFortySix } from './round46'
import { roundFortySeven } from './round47'
import { roundFortyEight } from './round48'
import { roundFifty } from './round50'
import { roundFiftyOne } from './round51'
import { roundFiftyTwo } from './round52'
import { roundFiftyThree } from './round53'
import { roundFiftyFour } from './round54'
import { roundFiftyFive } from './round55'
import { roundFiftySix } from './round56'
import { roundFiftySeven } from './round57'
import { roundSixty } from './round60'
import { roundSixtyOne } from './round61'
import { roundSixtyThree } from './round63'
import { roundSixtyFour } from './round64'
import { roundSixtyFive } from './round65'
import { roundSixtySix } from './round66'
import { roundSixtySeven } from './round67'
import { roundSeventyOne } from './round71'
import { roundSeventyTwo } from './round72'
import { roundSeventyThree } from './round73'
import { roundSeventyFive } from './round75'

export interface Author {
  id: string
  joinedAt: Date
}

export class Post {
  id = 'p1'
  tags = new Set(['a', 'b'])
  counts = new Map([['views', 1]])
  createdAt = new Date(0)
  author: Author = { id: 'a1', joinedAt: new Date(0) }
  nested = { labels: new Set(['x']) }
  #secret = 1

  get title(): string {
    return `post ${this.#secret}`
  }

  publish(): void {}
}

export class Money {
  constructor(private readonly cents: number) {}

  toJSON(): { amount: string; currency: 'USD' } {
    return { amount: String(this.cents / 100), currency: 'USD' }
  }
}

export class Instant {
  constructor(private readonly date: Date) {}

  toJSON(): Date {
    return this.date
  }
}

export class Receipt {
  toJSON(): Money {
    return new Money(5)
  }
}

export class Customer {
  id = 'c1'
  favorites = new Set(['sku-1'])
  since = new Date(0)
}

export class Session {
  #token = 's'
  private internal = 1
  startedAt = new Date(0)
  handlers = new Set(['a'])

  constructor(
    public user: string,
    public score = 1,
  ) {}

  get token(): string {
    return this.#token
  }

  get clicks(): number {
    return this.internal
  }
}

export class Channel {
  name = 'general'

  get topic(): string {
    return 't'
  }
}

export class Counter extends Map<string, number> {
  label = 'c'
}

export class Bag extends Array<number> {}

export class SpreadRoom {
  members = new Set(['a'])

  constructor(public id: string) {}

  toJSON() {
    // oxlint-disable-next-line typescript/no-misused-spread -- the pattern under test
    return { ...this }
  }
}

export class SpreadSizeRoom {
  members = new Set(['a'])

  constructor(public id: string) {}

  get size(): number {
    return this.members.size
  }

  toJSON() {
    // oxlint-disable-next-line typescript/no-misused-spread -- the pattern under test
    return { ...this, size: this.size }
  }
}

export class SelfRoom {
  constructor(public id: string) {}

  toJSON(): this {
    return this
  }
}

export class SelfOrNull {
  constructor(public id: string) {}

  toJSON(): this | null {
    return this
  }
}

export class MaybeDate {
  toJSON(): Date | string {
    return new Date(0)
  }
}

export class MoneyOrNull {
  toJSON(): Money | null {
    return new Money(5)
  }
}

export class Hidden {
  toJSON(): undefined {
    return undefined
  }
}

export class MaybeHidden {
  toJSON(): string | undefined {
    return undefined
  }
}

export class Dict {
  [key: string]: Set<string>
}

export class LiteralToJSON {
  m = {
    a: 1,
    toJSON() {
      return 'x'
    },
  }
}

export class TagSet extends Set<string> {
  toJSON(): string[] {
    return [...this]
  }
}

export class Stamp extends Date {
  override toJSON(): string {
    return 'stamp'
  }
}

export class HasOverrides {
  tags = new TagSet(['a'])
  at = new Stamp(0)
  plainSet = new Set(['b'])
}

export class TreeNode {
  children: TreeNode[] = []

  constructor(public label: string) {}
}

export interface TaggedModel {
  tags: Set<string>
}

export class HasTaggedModel {
  tagged: TaggedModel = { tags: new Set(['a']) }
}

export type Serializable = string | number | { toJSON(): Serializable }

export type UserId = Tagged<string, 'UserId'>

export interface PlainTags {
  tags: Set<string>
}

export class HasLibraryMapped {
  partial: Partial<PlainTags> = { tags: new Set(['a']) }
  pick: Pick<PlainTags, 'tags'> = { tags: new Set(['b']) }
  record: Record<string, Set<string>> = { a: new Set(['x']) }
}

export class SetRows extends Array<Set<string>> {}

export class HasSetRows {
  rows: SetRows = SetRows.from([new Set(['x'])]) as SetRows
}

export class CycleA {
  b: CycleB = { tags: new Set(['t']) }
}

export interface CycleB {
  a?: CycleA
  tags: Set<string>
}

export interface WithOwnToJSON {
  tags: Set<string>
  toJSON(): { n: number }
}

export class OwnToJSON implements WithOwnToJSON {
  tags = new Set(['a'])

  toJSON(): { n: number } {
    return { n: 1 }
  }
}

export class HoldsWithOwnToJSON {
  w: WithOwnToJSON = new OwnToJSON()
}

export interface TagSetLike extends Set<string> {}
export interface CountsLike extends Map<string, number> {}

export interface MutualA {
  id: string
  onlyA?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualB {
  id: string
  onlyB?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualC {
  id: string
  onlyC?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualD {
  id: string
  onlyD?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualE {
  id: string
  onlyE?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualF {
  id: string
  onlyF?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualG {
  id: string
  onlyG?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualH {
  id: string
  onlyH?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export interface MutualI {
  id: string
  onlyI?: true
  mA?: MutualA
  mB?: MutualB
  mC?: MutualC
  mD?: MutualD
  mE?: MutualE
  mF?: MutualF
  mG?: MutualG
  mH?: MutualH
  mI?: MutualI
}

export class HoldsMutual {
  m: MutualA = { id: 'x' }
}

export type Status = 'draft' | 'published' | null

export interface Plain {
  id: string
  big: bigint
  at: Date
  link: URL
  tags: Set<string>
  counts: Map<string, number>
  pair: [string, number?]
  holes: (string | undefined)[]
  optional?: string
  maybe: string | undefined
  status?: Status
  record: Record<string, { n: number }>
  prefixed: Record<`x-${string}`, string>
  union: { kind: 'a'; a: string } | { kind: 'b'; b: number[] }
  author: Author
}

export interface ProtoKey {
  __proto__: number
  name: string
}

export interface Boxed {
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  name: String
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  count: Number
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  ok?: Boolean
}

export interface MixedFunctions {
  a: string | (() => void)
  b: number | symbol
  list: (string | (() => void))[]
}

export interface FunctionValues {
  m: Record<string, string | (() => void)>
  nulls: (null | (() => void))[]
  undefineds: (undefined | (() => void))[]
}

export class DropJSON {
  a = 'x'

  toJSON(): undefined {
    return undefined
  }
}

export interface HoldsDropJSON {
  x: DropJSON & { b: number }
  y: (DropJSON & { b: number })[]
}

export type BrandedId = string & { __brand: 'BrandedId' }

export class BrandedJSON {
  id = 'u1'

  toJSON(): BrandedId {
    return this.id as BrandedId
  }
}

export interface HoldsBrandedJSON {
  k: BrandedJSON
  ks: BrandedJSON[]
}

export class SetIndex {
  [key: string]: Set<string> | number | (() => void)
}

export class SetOrFunction {
  tags: Set<string> | (() => void) = new Set(['a'])
}

export interface HiddenJSON {
  toJSON(): undefined
}

/** Arrays are walked by the serializer, which never calls their `toJSON` */
export interface WalkedIntersections {
  list: string[] & HiddenJSON
}

export class DroppedArrays {
  gone: string[] & { toJSON(): undefined } = Object.assign(['a'], { toJSON: () => undefined })
  maybe: string[] & { toJSON(): number | undefined } = Object.assign(['a'], {
    toJSON: () => undefined,
  })
}

interface MixedIterator {
  next():
    | { done: false; value: string }
    | { done: false; value: number }
    | { done: true; value: undefined }
}

export class MixedSet extends Set<string | number> {
  override [Symbol.iterator](): MixedIterator & SetIterator<string | number> {
    return super[Symbol.iterator]() as any
  }
}

/** Sets with a brand */
type BrandedSets = Set<string>[] & { readonly __brand?: 'sets' }

export class HoldsBrandedSets {
  sets: BrandedSets = [new Set(['a'])]
}

/** Returns a readonly date from `toJSON` */
export class ReadonlyDateJSON {
  toJSON(): Readonly<Date> {
    return new Date(0)
  }
}

/** Returns a partial date from `toJSON` */
export class PartialDateJSON {
  toJSON(): Partial<Date> {
    return new Date(0)
  }
}

export class TaggedJSON {
  tags = new Set(['a'])
  big = 1n

  toJSON(): string {
    return 'tagged'
  }
}

export class OptionalToJSONClass {
  tags = new Set(['x'])
  declare toJSON?: () => string
}

export class ReadonlyBytesJSON {
  toJSON(): Readonly<Uint8Array> {
    return new Uint8Array([1, 2])
  }
}

/** Not mapped over `T`: its values are objects holding `T` */
export type Box<T> = { [K in 'data']: T }

/** Bytes without fields of their own */
export class PlainBytes extends Uint8Array {}

export class LabeledBytes extends Uint8Array {
  label = 'x'
}

export class PrivateOptionalToJSON {
  #secret = 1
  tags = new Set(['p'])
  declare toJSON?: () => string

  get secret(): number {
    return this.#secret
  }
}

/** Only instances of the class are assignable, because of its `#private` member */
export interface ExtendsPrivate extends PrivateOptionalToJSON {}

export class TaggedView {
  tags = new Set(['t'])
  name = 'n'

  get label(): string {
    return this.name
  }
}

/** Only an instance is assignable, because of `private` */
export class TsPrivate {
  private secret = 1
  tags = new Set(['s'])
}

export interface ExtendsTsPrivate extends TsPrivate {}

/** Mapped views drop `#private` members, so plain objects are assignable */
export interface ExtendsPickedPrivate extends Pick<PrivateOptionalToJSON, 'tags'> {}

/** Keys of `T` with values of their own, not a view of `T` */
export type Flags<T> = { [K in keyof T]: Set<string> }

/** Returns labeled bytes from `toJSON` */
export class ReturnsLabeledBytes {
  toJSON(): LabeledBytes {
    return new LabeledBytes([1])
  }
}

/** A date subclass, which `JSON.stringify` writes by its own fields when `toJSON` returns it */
export class LabeledDate extends Date {
  label = 'l'
}

export class ReturnsLabeledDate {
  toJSON(): LabeledDate {
    return new LabeledDate(0)
  }
}

export class MaybeUndefinedJSON {
  toJSON(): string | undefined {
    return undefined
  }
}

export class FunctionOrStringJSON {
  toJSON(): string | (() => void) {
    return () => {}
  }
}

export class HoldsSettled {
  settled: PromiseFulfilledResult<Set<string>> = { status: 'fulfilled', value: new Set(['v']) }
}

export class KindJSON {
  tags = new Set(['k'])
  name = 'n'

  toJSON(): { kind: 'json' } {
    return { kind: 'json' }
  }
}

/** Values may also be `null` */
export type Nullable<T> = { [K in keyof T]: T[K] | null }

export class LabeledMap extends Map<string, number> {
  label = 'l'
}

export class HoldsMapIntersection {
  m: LabeledMap & { x: string } = Object.assign(new LabeledMap(), { x: 'x' })
}

/** Returns a readonly date subclass from `toJSON` */
export class ReturnsFrozenDate {
  toJSON(): Readonly<LabeledDate> {
    return new LabeledDate(0)
  }
}

/** Returns a date subclass with an extra field from `toJSON` */
export class ReturnsAssignedDate {
  toJSON(): LabeledDate & { x: string } {
    return Object.assign(new LabeledDate(0), { x: 'x' })
  }
}

/** An alias of a view of a class */
export type OmittedKind = Omit<KindJSON, 'name'>

export class Point {
  x = 1
}

export class BaseJSON {
  a = 'a'

  toJSON(): string {
    return 'json'
  }
}

export class DerivedJSON extends BaseJSON {
  b = 'b'
}

/** An alias of a view of a derived class */
export type PickedDerived = Pick<DerivedJSON, 'a' | 'b'>

export class GenericBox<T> {
  value!: T
  history: T[] = []
  x = 0
  tags = new Set(['b'])
}

/** An alias of a view of a generic class */
export type OmittedBox = Omit<GenericBox<string>, 'x'>

export class Counted extends Array<number> {
  label = 'a'
}

export class PlainFields {
  s = 's'
  tags = new Set(['p'])
}

/** An interface extending a class without private members */
export interface ExtendsPlain extends PlainFields {}

export class MaybeJSONClass {
  toJSON(): string | undefined {
    return undefined
  }
}

/** A chain of views, each a component */
export class ChainA {
  tags = new Set(['c'])
  next: Readonly<ChainB> | null = null
}

export class ChainB {
  tags = new Set(['c'])
  next: Readonly<ChainC> | null = null
}

export class ChainC {
  tags = new Set(['c'])
  next: Readonly<ChainA> | null = null
}

export class ArrayToJSONHolder {
  list: string[] & { toJSON(): number } = Object.assign(['a'], { toJSON: () => 5 })
}

/** A date with a brand, serialized as an empty object */
export class ToBrandedDate {
  toJSON(): Date & { __n: 1 } {
    return new Date(0) as Date & { __n: 1 }
  }
}

export class ToBrandedItems {
  toJSON(): number[] & { __n: 1 } {
    return [1] as number[] & { __n: 1 }
  }
}

/** A plain object, written by either one inside a view */
export interface TagsHolder {
  tags: Set<string>
  at: Date
}

export class HoldsTags {
  holder: TagsHolder = { tags: new Set(['h']), at: new Date(0) }
  big = 1n
  list: Set<string>[] = []
}

export const router = {
  post: os.handler(() => new Post()),
  posts: os.handler(() => [new Post(), new Post()]),
  money: os.handler(() => ({ total: new Money(1234), items: [new Money(1)] })),
  plain: os.handler((): Plain => ({
    id: '1',
    big: 10n,
    at: new Date(0),
    link: new URL('https://orpc.dev'),
    tags: new Set(['a']),
    counts: new Map([['a', 1]]),
    pair: ['a'],
    holes: ['a', undefined],
    maybe: undefined,
    status: null,
    record: { x: { n: 1 } },
    prefixed: { 'x-a': 'b' },
    union: { kind: 'b', b: [1] },
    author: { id: 'a', joinedAt: new Date(0) },
  })),
  literal: os.handler(() => ({
    a: 1,
    toJSON() {
      return 'ignored by the serializer'
    },
  })),
  echo: os.input(type<{ at: Date; tags: string[] }>()).handler(({ input }) => input),
  instant: os.handler(() => ({ at: new Instant(new Date(0)) })),
  receipt: os.handler(() => new Receipt()),
  frozen: os.handler((): Readonly<Customer> => Object.freeze(new Customer())),
  assigned: os.handler((): Customer & { extra: string } =>
    Object.assign(new Customer(), { extra: 'x' }),
  ),
  readonlySession: os.handler((): Readonly<Session> => new Session('x')),
  pickedSession: os.handler((): Pick<Session, 'user' | 'token' | 'handlers'> => new Session('p')),
  omittedChannel: os.handler((): Omit<Channel, 'name'> => new Channel()),
  readonlyCounter: os.handler((): Readonly<Counter> => new Counter([['a', 1]])),
  readonlyBag: os.handler((): Readonly<Bag> => Bag.from([1, 2]) as Bag),
  spreadRoom: os.handler(() => new SpreadRoom('r')),
  spreadSizeRoom: os.handler(() => new SpreadSizeRoom('r')),
  selfRoom: os.handler(() => new SelfRoom('r')),
  selfOrNull: os.handler(() => new SelfOrNull('s')),
  maybeDate: os.handler(() => ({ at: new MaybeDate() })),
  moneyOrNull: os.handler(() => ({ m: new MoneyOrNull() })),
  hidden: os.handler(() => ({ a: 1, h: new Hidden(), m: new MaybeHidden() })),
  dict: os.handler(() => {
    const dict = new Dict()
    dict.x = new Set(['a'])
    return dict
  }),
  literalToJSON: os.handler(() => new LiteralToJSON()),
  overrides: os.handler(() => new HasOverrides()),
  tree: os.handler(() => {
    const root = new TreeNode('root')
    root.children.push(new TreeNode('leaf'))
    return root
  }),
  trees: os.handler(() => [new TreeNode('a')]),
  taggedModel: os.handler(() => new HasTaggedModel()),
  serializable: os.handler((): { value: Serializable } => ({ value: { toJSON: () => 'x' } })),
  jsonifiable: os.handler((): { payload: Jsonifiable } => ({
    payload: { a: [1, 'x', null, true, { b: 2 }] },
  })),
  fixedLength: os.handler((): { rgb: FixedLengthArray<number, 3> } => ({ rgb: [1, 2, 3] })),
  brandedKeys: os.handler((): Record<UserId, Author> => ({
    ['u1' as UserId]: { id: 'a', joinedAt: new Date(0) },
  })),
  anything: os.handler((): { v: NonNullable<unknown>; w: {} } => ({ v: 5, w: 'x' })),
  libraryMapped: os.handler(() => new HasLibraryMapped()),
  setRows: os.handler(() => new HasSetRows()),
  cycleClass: os.handler(() => new CycleA()),
  cyclePlain: os.handler((): CycleB => ({ tags: new Set(['t']), a: new CycleA() })),
  ownToJSON: os.handler((): { w: WithOwnToJSON } => ({ w: new OwnToJSON() })),
  holdsOwnToJSON: os.handler(() => new HoldsWithOwnToJSON()),
  extendsBuiltins: os.handler((): { t: TagSetLike; c: CountsLike } => ({
    t: new Set(['a']),
    c: new Map([['a', 1]]),
  })),
  mutual: os.handler((): MutualA => ({ id: 'x' })),
  holdsMutual: os.handler(() => new HoldsMutual()),
  nestedPromise: os.handler(async () => ({
    user: Promise.resolve({ id: 'u' }),
    list: [Promise.resolve(1)],
  })),
  protoKey: os.handler((): ProtoKey => JSON.parse('{"__proto__":1,"name":"n"}')),
  boxed: os.handler((): Boxed => ({ name: 'n', count: 1, ok: true })),
  mixedFunctions: os.handler((): MixedFunctions => ({
    a: () => {},
    b: Symbol('b'),
    list: ['x', () => {}],
  })),
  functionValues: os.handler((): FunctionValues => ({
    m: { a: 'x', f: () => {} },
    nulls: [null, () => {}],
    undefineds: [undefined, () => {}],
  })),
  holdsDropJSON: os.handler((): HoldsDropJSON => {
    const value = Object.assign(new DropJSON(), { b: 1 })
    return { x: value, y: [value] }
  }),
  holdsBrandedJSON: os.handler((): HoldsBrandedJSON => ({
    k: new BrandedJSON(),
    ks: [new BrandedJSON()],
  })),
  setIndex: os.handler((): SetIndex => Object.assign(new SetIndex(), { x: new Set(['a']) })),
  setOrFunction: os.handler(() => new SetOrFunction()),
  walkedIntersections: os.handler((): WalkedIntersections => ({
    list: Object.assign(['a'], { toJSON: () => undefined }),
  })),
  toBranded: os.handler(() => ({ date: new ToBrandedDate(), items: new ToBrandedItems() })),
  arrayToJSON: os.handler(() => new ArrayToJSONHolder()),
  libraryClasses: os.handler(() => ({
    typeError: new TypeError('bad'),
    params: new URLSearchParams('a=1'),
    response: new Response('x'),
    zodError: z.string().safeParse(1).error!,
  })),
  droppedArrays: os.handler(() => new DroppedArrays()),
  mixedSet: os.handler(() => ({ set: new MixedSet(['a', 1]) })),
  brandedSets: os.handler(() => new HoldsBrandedSets()),
  partialMoney: os.handler((): { m: Partial<Money>; list: Partial<Money>[] } => ({
    m: new Money(150),
    list: [new Money(1)],
  })),
  mappedDates: os.handler(() => ({ r: new ReadonlyDateJSON(), p: new PartialDateJSON() })),
  partialPlain: os.handler((): { p: Partial<TaggedJSON>; list: Partial<TaggedJSON>[] } => ({
    p: { tags: new Set(['a']) },
    list: [{ tags: new Set(['b']), big: 2n }, new TaggedJSON()],
  })),
  optionalToJSONClass: os.handler(() => ({ value: new OptionalToJSONClass() })),
  readonlyBytes: os.handler((): { json: ReadonlyBytesJSON; field: Readonly<Uint8Array> } => ({
    json: new ReadonlyBytesJSON(),
    field: new Uint8Array([3]),
  })),
  wrappedOptionalToJSON: os.handler(
    (): {
      frozen: Readonly<OptionalToJSONClass>
      picked: Pick<OptionalToJSONClass, 'tags' | 'toJSON'>
      assigned: OptionalToJSONClass & { extra: Set<string> }
    } => ({
      frozen: Object.freeze(new OptionalToJSONClass()),
      picked: new OptionalToJSONClass(),
      assigned: Object.assign(new OptionalToJSONClass(), { extra: new Set(['e']) }),
    }),
  ),
  readonlyBinary: os.handler((): { buffer: Readonly<ArrayBuffer>; view: Readonly<DataView> } => ({
    buffer: new ArrayBuffer(2),
    view: new DataView(new ArrayBuffer(2)),
  })),
  bytesAndBoxes: os.handler(
    (): {
      box: Box<Uint8Array>
      plain: PlainBytes
      labeled: LabeledBytes
      frozen: Readonly<LabeledBytes>
      partial: Partial<LabeledBytes>
    } => ({
      box: { data: new Uint8Array([1]) },
      plain: new PlainBytes([2]),
      labeled: new LabeledBytes([3]),
      frozen: new LabeledBytes([4]),
      partial: new LabeledBytes([5]),
    }),
  ),
  optionalToJSONViews: os.handler(
    (): {
      plain: Partial<OptionalToJSONClass>
      instance: Partial<OptionalToJSONClass>
      private: ExtendsPrivate
    } => ({
      plain: { tags: new Set(['z']) },
      instance: new OptionalToJSONClass(),
      private: new PrivateOptionalToJSON(),
    }),
  ),
  views: os.handler(
    (): {
      picked: Pick<TaggedView, 'tags'>
      pickedInstance: Pick<TaggedView, 'tags'>
      frozenIntersection: Readonly<TaggedView & { extra: string }>
      tsPrivate: ExtendsTsPrivate
      pickedPrivate: ExtendsPickedPrivate
      flags: Flags<TaggedView>
    } => ({
      picked: { tags: new Set(['p']) },
      pickedInstance: new TaggedView(),
      frozenIntersection: Object.freeze(Object.assign(new TaggedView(), { extra: 'e' })),
      tsPrivate: new TsPrivate(),
      pickedPrivate: { tags: new Set(['q']) },
      flags: { tags: new Set(['f']), name: new Set(['g']), label: new Set(['h']) },
    }),
  ),
  toJSONResults: os.handler(() => ({
    bytes: new ReturnsLabeledBytes(),
    date: new ReturnsLabeledDate(),
    maybe: [new MaybeUndefinedJSON()],
    fn: new FunctionOrStringJSON(),
  })),
  builtinViews: os.handler(
    (): { error: Readonly<Error>; regexp: Readonly<RegExp>; settled: HoldsSettled } => ({
      error: new Error('x'),
      regexp: /a/,
      settled: new HoldsSettled(),
    }),
  ),
  moreViews: os.handler(
    (): {
      privateView: Readonly<TsPrivate> & { extra: string }
      pickedJSON: Pick<KindJSON, 'tags'>
      pickedJSONList: Pick<KindJSON, 'name'>[]
      pickedDate: Pick<LabeledDate, 'label'>
      nullable: Nullable<KindJSON>
      aliased: OmittedKind
      aliasedPlain: OmittedKind
    } => ({
      privateView: { tags: new Set(['a']), extra: 'e' },
      pickedJSON: new KindJSON(),
      pickedJSONList: [new KindJSON(), { name: 'plain' }],
      pickedDate: { label: 'p' },
      nullable: new KindJSON(),
      aliased: new KindJSON(),
      // the serializer walks a plain object key by key, skipping its `toJSON`
      aliasedPlain: { tags: new Set(['o']), toJSON: () => ({ kind: 'json' as const }) },
    }),
  ),
  moreToJSON: os.handler(
    (): {
      mixed: (MaybeUndefinedJSON | number)[]
      maybe: MaybeUndefinedJSON | number
      maps: HoldsMapIntersection
      frozenDate: ReturnsFrozenDate
      assignedDate: ReturnsAssignedDate
    } => ({
      mixed: [new MaybeUndefinedJSON(), 1],
      maybe: new MaybeUndefinedJSON(),
      maps: new HoldsMapIntersection(),
      frozenDate: new ReturnsFrozenDate(),
      assignedDate: new ReturnsAssignedDate(),
    }),
  ),
  roundTwentyThree: os.handler(
    (): {
      assignedJSON: Point & { toJSON: () => number }
      pickedDerived: PickedDerived
      omittedBox: OmittedBox
      readonlySet: Readonly<Set<string> & { x: string }>
      bytes: Uint8Array & { x: string }
      partialCounted: Partial<Counted>
      partialDate: Partial<Date>
      extendsPlain: ExtendsPlain
      omittedJSON: { v: Omit<MaybeJSONClass, 'toJSON'> }
      chain: Readonly<ChainA>
    } => ({
      assignedJSON: Object.assign(new Point(), { toJSON: () => 5 }),
      pickedDerived: new DerivedJSON(),
      omittedBox: { value: 'v', history: [], tags: new Set(['o']) },
      readonlySet: Object.assign(new Set(['a']), { x: 'x' }),
      bytes: Object.assign(new Uint8Array([1]), { x: 'x' }),
      partialCounted: { label: 'x' },
      partialDate: {},
      extendsPlain: new PlainFields(),
      omittedJSON: { v: new MaybeJSONClass() },
      chain: new ChainA(),
    }),
  ),
  eitherForms: os.handler(
    (): {
      plain: Pick<HoldsTags, 'holder' | 'big' | 'list'>
      instance: Omit<HoldsTags, 'big'>
      holder: TagsHolder
    } => ({
      plain: { holder: { tags: new Set(['p']), at: new Date(0) }, big: 2n, list: [new Set(['l'])] },
      instance: Object.assign(new HoldsTags(), { big: undefined }),
      holder: { tags: new Set(['t']), at: new Date(0) },
    }),
  ),
  ...roundTwentyFive,
  ...roundTwentySix,
  ...roundTwentySeven,
  ...roundTwentyEight,
  ...roundTwentyNine,
  ...roundThirty,
  ...roundThirtyOne,
  ...roundThirtyTwo,
  ...roundThirtyThree,
  ...roundThirtyFive,
  ...roundThirtySix,
  ...roundThirtySeven,
  ...roundThirtyNine,
  ...roundFortyTwo,
  ...roundFortyFour,
  ...roundFortySix,
  ...roundFortySeven,
  ...roundFortyEight,
  ...roundFifty,
  ...roundFiftyOne,
  ...roundFiftyTwo,
  ...roundFiftyThree,
  ...roundFiftyFour,
  ...roundFiftyFive,
  ...roundFiftySix,
  ...roundFiftySeven,
  ...roundSixty,
  ...roundSixtyOne,
  ...roundSixtyThree,
  ...roundSixtyFour,
  ...roundSixtyFive,
  ...roundSixtySix,
  ...roundSixtySeven,
  ...roundSeventyOne,
  ...roundSeventyTwo,
  ...roundSeventyThree,
  ...roundSeventyFive,
}
