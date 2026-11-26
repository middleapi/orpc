import type { Schema as ORPCSchema } from '@orpc/server'
import { os, type } from '@orpc/server'

/** A flat model with optional and nullable fields */
export interface Flat {
  id: string
  name?: string
  note: string | null
  count: number
  active?: boolean | null
}

/** A nested model with arrays and dates */
export interface Nested {
  title: string
  tags: string[]
  createdAt: Date
  items: { label: string; at: Date; scores: number[] }[]
  meta?: { updatedAt?: Date; by: string }
}

/** A class sent by its toJSON */
export class Money {
  constructor(public cents: number) {}

  toJSON(): { amount: string; currency: 'USD' } {
    return { amount: (this.cents / 100).toFixed(2), currency: 'USD' }
  }
}

/** A discriminated union */
export type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; size: number; label?: string }

/** A recursive tree */
export interface TreeNode {
  value: string
  children: TreeNode[]
}

/** A branded id */
export type UserId = string & { readonly __brand: 'UserId' }

/** A tuple */
export type Pair = [string, number, Date]

/** A string literal union, for the string utilities */
export type Label = 'user_name' | 'created-at'

/** A service class with methods, for `ReturnType`, `Parameters` and `InstanceType` */
export class Service {
  constructor(
    public name: string,
    public startedAt: Date,
  ) {}

  find(id: string, options?: { limit: number }): Flat {
    return { id, note: null, count: options?.limit ?? 0 }
  }

  async list(): Promise<Nested[]> {
    return []
  }

  shape(this: Service, radius: number): Shape {
    return { kind: 'circle', radius }
  }

  static create(name: string): Service {
    return new Service(name, new Date(0))
  }
}

export function makePair(label: string, count: number): Pair {
  return [label, count, new Date(0)]
}

function literal<const T>(value: T): T {
  return value
}

const labels = ['user_name', 'created-at'] as const
const config = { mode: 'fast', retries: 3, tags: ['x'] } as const
const flatValue = { id: 'f1', note: null, count: 1 }

type MinusReadonly<T> = { -readonly [K in keyof T]: T[K] }
type PlusReadonly<T> = { +readonly [K in keyof T]: T[K] }
type MinusOptional<T> = { [K in keyof T]-?: T[K] }
type PlusOptional<T> = { [K in keyof T]+?: T[K] }
type Homomorphic<T> = { [K in keyof T]: T[K] }
type Getters<T> = { [K in keyof T as `get${Capitalize<K & string>}`]: T[K] }
type UpperKeys<T> = { [K in keyof T as Uppercase<K & string>]: T[K] }
type StringFields<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] }
type Without<T, X> = { [K in keyof T as Exclude<K, X>]: T[K] }
type ElementOf<T> = T extends readonly (infer E)[] ? E : never
type UnwrapPromise<T> = T extends PromiseLike<infer U> ? U : T
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never
type FirstOf<T> = T extends readonly [infer F, ...unknown[]] ? F : never
type RestOf<T> = T extends readonly [unknown, ...infer R] ? R : never
type PropOf<T, K extends PropertyKey> = T extends { [P in K]: infer V } ? V : never
type StringFirst<T> = T extends readonly [infer F extends string, ...unknown[]] ? F : never
type Head<S> = S extends `${infer A}_${string}` ? A : S extends `${infer A}-${string}` ? A : never
type Jsonish<T> = T extends Date
  ? string
  : T extends readonly unknown[]
    ? { [K in keyof T]: Jsonish<T[K]> }
    : T extends object
      ? { [K in keyof T]: Jsonish<T[K]> }
      : T

const flat = { id: 'f1', name: 'n', note: null, count: 1, active: true } satisfies Flat
const at = new Date(0)
const nested = {
  title: 't',
  tags: ['a'],
  createdAt: at,
  items: [{ label: 'l', at, scores: [1] }],
  meta: { updatedAt: at, by: 'b' },
} satisfies Nested
const money = new Money(150)
const circle = { kind: 'circle', radius: 1 } satisfies Shape
const square = { kind: 'square', size: 2, label: 's' } satisfies Shape
const tree: TreeNode = { value: 'r', children: [{ value: 'c', children: [] }] }
const service = new Service('s', at)
const userId = 'u1' as UserId
const pair = ['p', 1, at] satisfies Pair

/** An output returning the value, and an input of its type */
const sample = <T>(schema: ORPCSchema<T, T>, value: NoInfer<T>) => ({
  output: os.handler((): T => value),
  input: os.input(schema).handler(() => 1),
})

/** An output returning the value, and an input, of the type inferred from it */
const inferred = <T>(value: T) =>
  sample(
    type<T, T>((input) => input),
    value,
  )

/** An output only, of a type no client sends (`Promise<T>`) */
const output = <T>(_schema: ORPCSchema<T, T>, value: () => NoInfer<T>) => ({
  output: os.handler((): T => value()),
})

/** A sample of each built-in utility and type operator applying to data, applied to one of the models */
export const builtinTypes = {
  Partial: sample(type<Partial<Nested>>(), nested),
  Required: sample(type<Required<Flat>>(), flat),
  Readonly: sample(type<Readonly<Shape>>(), square),
  Pick: sample(type<Pick<TreeNode, 'value'>>(), { value: 'r' }),
  Omit: sample(type<Omit<Money, 'toJSON'>>(), { cents: 150 }),
  Record: sample(type<Record<Label, Service>>(), { 'user_name': service, 'created-at': service }),
  RecordString: sample(type<Record<string, Pair>>(), { 'user_name': pair, 'created-at': pair }),
  RecordNumber: sample(type<Record<number, UserId>>(), { '1': userId }),
  RecordPropertyKey: sample(type<Record<PropertyKey, Nested>>(), {
    'user_name': nested,
    'created-at': nested,
  }),
  Exclude: sample(type<Exclude<Flat | null | undefined, null | undefined>>(), flat),
  ExcludeMember: sample(type<Exclude<Shape, { kind: 'circle' }>>(), square),
  ExcludeLiteral: sample(type<Exclude<Label, 'created-at'>>(), 'user_name'),
  Extract: sample(type<Extract<Money | number[] | null, Money>>(), money),
  ExtractMember: sample(type<Extract<Shape, { kind: 'circle' }>>(), circle),
  NonNullable: sample(type<NonNullable<Pair | null | undefined>>(), pair),
  NonNullableField: sample(type<NonNullable<Nested['meta']>>(), { updatedAt: at, by: 'b' }),
  ReturnType: sample(type<ReturnType<() => Nested>>(), nested),
  ReturnTypeMethod: sample(type<ReturnType<Service['find']>>(), flat),
  ReturnTypeFunction: sample(type<ReturnType<typeof makePair>>(), pair),
  ReturnTypeStatic: sample(type<ReturnType<typeof Service.create>>(), service),
  Parameters: sample(type<Parameters<(value: Money, count?: number) => void>>(), [
    money,
    undefined,
  ]),
  ParametersMethod: sample(type<Parameters<Service['find']>>(), ['f1', { limit: 2 }]),
  ParametersFunction: sample(type<Parameters<typeof makePair>>(), ['p', 1]),
  ConstructorParameters: sample(type<ConstructorParameters<new (value: UserId) => object>>(), [
    userId,
  ]),
  ConstructorParametersClass: sample(type<ConstructorParameters<typeof Service>>(), ['s', at]),
  InstanceType: sample(type<InstanceType<new () => Flat>>(), flat),
  InstanceTypeClass: sample(type<InstanceType<typeof Service>>(), service),
  ThisParameterType: sample(type<ThisParameterType<(this: TreeNode) => void>>(), tree),
  ThisParameterTypeMethod: sample(type<ThisParameterType<Service['shape']>>(), service),
  OmitThisParameter: sample(
    type<ReturnType<OmitThisParameter<(this: Flat, value: Service) => Service>>>(),
    service,
  ),
  OmitThisParameterArgs: sample(
    type<Parameters<OmitThisParameter<(this: Flat, value: Pair) => void>>>(),
    [pair],
  ),
  Awaited: sample(type<Awaited<Promise<UserId>>>(), userId),
  AwaitedNested: sample(type<Awaited<Promise<Promise<Nested>>>>(), nested),
  AwaitedPlain: sample(type<Awaited<Flat>>(), flat),
  AwaitedMethod: sample(type<Awaited<ReturnType<Service['list']>>>(), [nested, nested]),
  Promise: output(type<Promise<TreeNode>>(), () => Promise.resolve(tree)),
  PromiseLike: output(type<PromiseLike<Money>>(), () => Promise.resolve(money)),
  PromiseOrValue: output(type<Promise<Service> | Service>(), () => Promise.resolve(service)),
  Uppercase: sample(type<Uppercase<Label>>(), 'CREATED-AT'),
  Lowercase: sample(type<Lowercase<Label>>(), 'created-at'),
  Capitalize: sample(type<Capitalize<Label>>(), 'Created-at'),
  Uncapitalize: sample(type<Uncapitalize<Label>>(), 'created-at'),
  UppercaseString: sample(type<Uppercase<string>>(), 'ID_1'),
  UppercaseTemplate: sample(type<Uppercase<`id_${number}`>>(), 'ID_1'),
  CapitalizeTemplate: sample(type<`${Capitalize<Label>}Id`>(), 'Created-atId'),
  UppercaseKeys: sample(type<Uppercase<keyof Pair & string>>(), 'LENGTH'),
  NoInfer: sample(type<NoInfer<Pair>>(), pair),
  ReadonlyArray: sample(type<ReadonlyArray<UserId>>(), [userId, userId]),
  ReadonlyArrayOperator: sample(type<readonly Nested[]>(), [nested, nested]),
  Array: sample(type<Array<Flat>>(), [flat, flat]),
  ArrayLike: sample(type<ArrayLike<Shape>>(), [square, square]),
  ConcatArray: sample(type<ConcatArray<TreeNode>>(), [tree, tree]),
  ReadonlySet: sample(type<ReadonlySet<Money>>(), new Set([money])),
  ReadonlyMap: sample(type<ReadonlyMap<string, Service>>(), new Map([['a', service]])),
  FlatArray: sample(type<FlatArray<Pair[][], 1>>(), pair),
  IteratorResult: sample(type<IteratorResult<UserId, undefined>>(), { done: false, value: userId }),
  PromiseSettledResult: sample(type<PromiseSettledResult<Nested>>(), {
    status: 'fulfilled',
    value: nested,
  }),
  TypedPropertyDescriptor: sample(type<TypedPropertyDescriptor<Flat>>(), {
    value: flat,
    writable: true,
  }),
  ThisType: sample(type<Shape & ThisType<Shape>>(), square),
  PropertyKey: sample(type<PropertyKey>(), 'a'),
  Keyof: sample(type<keyof Money>(), 'toJSON'),
  KeyofString: sample(type<keyof Pair & string>(), 'length'),
  IndexedRequired: sample(type<Pair['0']>(), 'p'),
  IndexedOptional: sample(type<Nested['meta']>(), { updatedAt: at, by: 'b' }),
  IndexedKeyof: sample(type<Nested[keyof Nested]>(), [{ label: 'l', at, scores: [1] }]),
  IndexedNumber: sample(type<Flat[][number]>(), flat),
  IndexedTupleNumber: sample(type<Pair[number]>(), at),
  IndexedTupleDate: sample(type<Pair[2]>(), at),
  IndexedNestedElement: sample(type<Nested['items'][number]>(), { label: 'l', at, scores: [1] }),
  IndexedUnionKind: sample(type<Shape['kind']>(), 'circle'),
  IndexedRecursive: sample(type<TreeNode['children']>(), [{ value: 'c', children: [] }]),
  TypeofConstArray: sample(type<(typeof labels)[number]>(), 'created-at'),
  TypeofConstObject: sample(type<typeof config>(), config),
  KeyofTypeof: sample(type<keyof typeof config>(), 'mode'),
  TypeofIndexed: sample(type<(typeof config)['tags']>(), config.tags),
  TypeofValue: sample(type<typeof flatValue>(), { id: 'f1', note: null, count: 1 }),
  TypeofInstance: sample(type<typeof Service.prototype>(), service),
  Typeof: inferred({ name: 's', startedAt: '1970-01-01T00:00:00.000Z' }),
  Satisfies: inferred(['p', 1, new Date(0)] satisfies Pair),
  AsConst: inferred('u1' as const),
  AsConstSatisfies: inferred({
    title: 't',
    tags: ['a'],
    createdAt: new Date(0),
    items: [{ label: 'l', at: new Date(0), scores: [1] }],
    meta: { updatedAt: new Date(0), by: 'b' },
  } as const satisfies Nested),
  ConstTypeParameter: inferred(
    literal({ id: 'f1', name: 'n', note: null, count: 1, active: true }),
  ),
  InferIdentity: sample(type<Shape extends infer U ? U : never>(), square),
  InferElement: sample(type<ElementOf<TreeNode[]>>(), tree),
  InferPromise: sample(type<UnwrapPromise<Promise<Money>>>(), money),
  InferReturn: sample(type<ReturnOf<() => Service>>(), service),
  InferProperty: sample(type<PropOf<Pair, '0'>>(), 'p'),
  InferFirst: sample(type<FirstOf<Pair>>(), 'p'),
  InferRest: sample(type<RestOf<Pair>>(), [1, at]),
  InferConstrained: sample(type<StringFirst<Pair>>(), 'p'),
  InferTemplate: sample(type<Head<Label>>(), 'created'),
  InferDeep: sample(type<Jsonish<TreeNode>>(), tree),
  DistributiveConditional: sample(
    type<Money | null extends infer U ? (U extends null ? never : U) : never>(),
    money,
  ),
  MinusReadonly: sample(type<MinusReadonly<Service>>(), service),
  PlusReadonly: sample(type<PlusReadonly<Pair>>(), pair),
  MinusOptional: sample(type<MinusOptional<UserId>>(), userId),
  PlusOptional: sample(type<PlusOptional<Nested>>(), nested),
  Homomorphic: sample(type<Homomorphic<Flat>>(), flat),
  MappedKeys: sample(type<{ [K in keyof Pair & string]: Pair[K] }>(), pair),
  RemapGetters: sample(type<Getters<TreeNode>>(), {
    getValue: 'r',
    getChildren: [{ value: 'c', children: [] }],
  }),
  RemapUpper: sample(type<UpperKeys<Money>>(), {
    CENTS: 150,
    TOJSON: () => ({ amount: '1.50', currency: 'USD' as const }),
  }),
  RemapFilter: sample(type<StringFields<Service>>(), { name: 's' }),
  RemapExclude: sample(type<Without<Nested, 'tags'>>(), {
    title: 't',
    createdAt: at,
    items: [{ label: 'l', at, scores: [1] }],
    meta: { updatedAt: at, by: 'b' },
  }),
  PartialPick: sample(type<Partial<Pick<Nested, 'title' | 'createdAt'>>>(), {
    title: 't',
    createdAt: at,
  }),
  PickPartial: sample(type<Pick<Partial<Nested>, 'title' | 'createdAt'>>(), {
    title: 't',
    createdAt: at,
  }),
  ReadonlyPartial: sample(type<Readonly<Partial<Flat>>>(), flat),
  RequiredPartial: sample(type<Required<Partial<Shape>>>(), square),
  PartialReadonly: sample(type<Partial<Readonly<TreeNode>>>(), tree),
  RequiredReadonly: sample(type<Required<Readonly<Money>>>(), money),
  OmitRequired: sample(type<Omit<Required<Service>, 'startedAt'>>(), service),
  RequiredPick: sample(type<Required<Pick<Nested, 'title' | 'createdAt'>>>(), {
    title: 't',
    createdAt: at,
  }),
  PickExclude: sample(type<Pick<Nested, Exclude<keyof Nested, 'tags'>>>(), {
    title: 't',
    createdAt: at,
    items: [{ label: 'l', at, scores: [1] }],
    meta: { updatedAt: at, by: 'b' },
  }),
  ExcludeKeyof: sample(type<Exclude<keyof Nested, 'tags'>>(), 'createdAt'),
  PartialRecord: sample(type<Partial<Record<Label, Flat>>>(), {
    'user_name': flat,
    'created-at': flat,
  }),
  RecordPartial: sample(type<Record<Label, Partial<Shape>>>(), {
    'user_name': square,
    'created-at': square,
  }),
  ReadonlyRecord: sample(type<Readonly<Record<Label, TreeNode>>>(), {
    'user_name': tree,
    'created-at': tree,
  }),
  RecordKeyof: sample(type<Record<keyof Money, string>>(), { cents: 'x', toJSON: 'x' }),
  ReadonlyArrayReadonly: sample(type<ReadonlyArray<Readonly<Service>>>(), [service, service]),
  ReadonlyOfArray: sample(type<Readonly<Pair[]>>(), [pair, pair]),
  ArrayOfPartial: sample(type<Partial<UserId>[]>(), [userId, userId]),
  NonNullablePartial: sample(type<NonNullable<Partial<Nested>>>(), nested),
  PartialNonNullable: sample(type<Partial<NonNullable<Flat>>>(), flat),
  PartialPartial: sample(type<Partial<Partial<Shape>>>(), square),
  PartialReturnType: sample(type<Partial<ReturnType<() => TreeNode>>>(), tree),
  AwaitedReturnType: sample(type<Awaited<ReturnType<() => Promise<Money>>>>(), money),
  PromisePartial: output(type<Promise<Partial<Service>>>(), () => Promise.resolve(service)),
  NoInferPartial: sample(type<NoInfer<Partial<Pair>>>(), pair),
  PickKeyof: sample(type<Pick<Nested, keyof Nested>>(), nested),
  ParametersIndexed: sample(type<NonNullable<Parameters<Service['find']>[1]>>(), { limit: 2 }),
  ExtractIndexed: sample(type<Extract<Shape, { kind: 'square' }>['size']>(), 2),
  UppercaseIndexed: sample(type<Uppercase<Shape['kind']>>(), 'CIRCLE'),
  RecordIndexed: sample(type<Record<Shape['kind'], number>>(), { circle: 1, square: 2 }),
  PartialUnion: sample(type<Partial<Shape>>(), { kind: 'circle' }),
  PickUnion: sample(type<Pick<Shape, 'kind'>>(), { kind: 'circle' }),
  RequiredUnion: sample(type<Required<Shape>>(), square),
  MappedKeysArray: sample(type<{ [K in keyof UserId[] & string]: UserId[][K] }>(), [
    userId,
    userId,
  ]),
  MappedNumericKeys: sample(type<{ [K in keyof Pair & `${number}`]: Pair[K] }>(), {
    '0': 'p',
    '1': 1,
    '2': at,
  }),
  MappedOwnIndexes: sample(type<{ [K in Exclude<keyof Pair, keyof unknown[]>]: Pair[K] }>(), {
    '0': 'p',
    '1': 1,
    '2': at,
  }),
  OmitTuple: sample(type<Omit<Pair, 'length'>>(), pair),
  OmitArray: sample(type<Omit<TreeNode[], 'push'>>(), [tree, tree]),
  OmitPrimitive: sample(type<Omit<UserId, 'charAt'>>(), userId),
  PickPrimitive: sample(type<Pick<UserId, 'length'>>(), userId),
  MinusReadonlyOfReadonly: sample(type<MinusReadonly<Readonly<Pair>>>(), pair),
  RequiredOfPartialAlias: sample(type<MinusOptional<PlusOptional<UserId>>>(), userId),
  HomomorphicArray: sample(type<Homomorphic<Nested[]>>(), [nested, nested]),
  HomomorphicReadonlyTuple: sample(type<Homomorphic<readonly [Flat, number]>>(), [flat, 1]),
  InstanceTypeToJSON: sample(type<InstanceType<typeof Money>>(), money),
  ConstructorParametersToJSON: sample(type<ConstructorParameters<typeof Money>>(), [150]),
  ReturnTypeToJSON: sample(type<ReturnType<Money['toJSON']>>(), {
    amount: '1.50',
    currency: 'USD',
  }),
  ParametersElement: sample(type<Parameters<typeof makePair>[number]>(), 'p'),
  AwaitedUnion: sample(type<Awaited<Pair | Promise<Pair>>>(), pair),
  ExtractKeys: sample(type<Extract<keyof UserId, string>>(), '__brand'),
  ReadonlyRecordString: sample(type<Readonly<Record<string, Nested>>>(), {
    'user_name': nested,
    'created-at': nested,
  }),
  PartialRecordPick: sample(type<Partial<Record<keyof Pick<Flat, 'id' | 'count'>, Flat>>>(), {
    id: flat,
    count: flat,
  }),
  ReturnTypeUnion: sample(type<ReturnType<(() => Shape) | (() => null)>>(), square),
  ReturnTypeGeneric: sample(type<ReturnType<<T>(value: T) => T[]>>(), [1, 'x']),
  InstanceTypeAbstract: sample(type<InstanceType<abstract new () => Money>>(), money),
  ReadonlyNested: sample(type<Readonly<Nested>['items']>(), [{ label: 'l', at, scores: [1] }]),
  ElementOfReadonlyTuple: sample(type<ElementOf<readonly [Pair, number]>>(), pair),
  AwaitedPromiseLike: sample(type<Awaited<PromiseLike<UserId>>>(), userId),
}
