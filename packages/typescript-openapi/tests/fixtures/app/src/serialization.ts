import { os, type } from '@orpc/server'
import type { FixedLengthArray, Jsonifiable, Tagged } from 'type-fest'

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
  nestedPromise: os.handler(async () => ({
    user: Promise.resolve({ id: 'u' }),
    list: [Promise.resolve(1)],
  })),
}
