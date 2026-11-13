import { os, type } from '@orpc/server'

/** Each value, read-only, deeply */
type ConditionalDeep<T> = T extends object ? { readonly [K in keyof T]: ConditionalDeep<T[K]> } : T

/** Each value, optional, deeply */
type ConditionalPartial<T> = T extends object ? { [K in keyof T]?: ConditionalPartial<T[K]> } : T

/** A page of items, nested in pages of other items */
export interface FeedPage<T> {
  items: T[]
  total: number
}

export interface FeedLike {
  by: string
}

export interface FeedReply {
  text: string
  likes: FeedPage<FeedLike>
}

export interface FeedComment {
  text: string
  replies: FeedPage<FeedReply>
}

export interface FeedPost {
  title: string
  comments: FeedPage<FeedComment>
}

/** A model whose relations nest four pages deep */
export interface FeedAuthor {
  name: string
  posts: FeedPage<FeedPost>
}

export interface Wrapped<T> {
  v: T
}

const page = <T>(items: T[]): FeedPage<T> => ({ items, total: items.length })
const author: FeedAuthor = {
  name: 'a',
  posts: page([
    {
      title: 't',
      comments: page([{ text: 'c', replies: page([{ text: 'r', likes: page([{ by: 'b' }]) }]) }]),
    },
  ]),
}

/**
 * Conditional deep mapped types over finite models with nested generic relations, and object
 * types an array satisfies besides optional properties no array has.
 */
export const nestedPages = {
  deepFeed: os.handler((): ConditionalDeep<FeedAuthor> => author),
  partialFeed: os.handler((): ConditionalPartial<FeedAuthor> => author),
  nestedBoxes: os.handler((): ConditionalDeep<Wrapped<Wrapped<Wrapped<Wrapped<number>>>>> => ({
    v: { v: { v: { v: 1 } } },
  })),
  lengthExtra: os.handler((): { length: number; extra?: string } => [1]),
}

/** Inputs of the same types, as a client sends them */
export const nestedPagesInputs = {
  deepFeed: os.input(type<ConditionalDeep<FeedAuthor>>()).handler(() => 1),
  nestedBoxes: os
    .input(type<ConditionalDeep<Wrapped<Wrapped<Wrapped<Wrapped<number>>>>>>())
    .handler(() => 1),
  lengthExtra: os.input(type<{ v: { length: number; extra?: string } }>()).handler(() => 1),
}
