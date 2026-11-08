import { os, type } from '@orpc/server'

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
}
