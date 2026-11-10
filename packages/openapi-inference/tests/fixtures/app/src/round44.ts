import { os } from '@orpc/server'

/** Sent as the string its `toJSON` returns, the same for equal amounts */
export class Price {
  constructor(private readonly cents: number) {}

  toJSON(): string {
    return (this.cents / 100).toFixed(2)
  }
}

/** Sent as the number its `toJSON` returns */
export class Score {
  constructor(private readonly value: number) {}

  toJSON(): number {
    return this.value
  }
}

/** A user, whose posts and pinned comment link back to it */
export interface LinkedUser {
  name: string
  posts: LinkedPost[]
  pinned: LinkedComment | null
}

/** A post, linking to its author and comments */
export interface LinkedPost {
  author: LinkedUser
  comments: LinkedComment[]
}

/** A comment, linking to its author and post */
export interface LinkedComment {
  author: LinkedUser
  post: LinkedPost
}

const user: LinkedUser = { name: 'u', posts: [], pinned: null }
const post: LinkedPost = { author: user, comments: [] }
const comment: LinkedComment = { author: { name: 'v', posts: [], pinned: null }, post }

export const roundFortyFour = {
  // distinct instances written as the same JSON are no unique items
  priceSet: os.handler((): Set<Price> => new Set([new Price(100), new Price(100)])),
  priceSets: os.handler((): { prices: Set<Price | string>; scores: ReadonlySet<Score> } => ({
    prices: new Set([new Price(100), '1.00']),
    scores: new Set([new Score(1), new Score(1)]),
  })),
  linkedUser: os.handler((): LinkedUser => ({
    name: 'w',
    posts: [{ author: user, comments: [comment] }],
    pinned: comment,
  })),
}
