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

/** The first of twenty classes, each linking to the next two, the last back to the first */
export class FibTwentyA {
  next: FibTwentyB | null = null
  skip: FibTwentyC | null = null
}

export class FibTwentyB {
  next: FibTwentyC | null = null
  skip: FibTwentyD | null = null
}

export class FibTwentyC {
  next: FibTwentyD | null = null
  skip: FibTwentyE | null = null
}

export class FibTwentyD {
  next: FibTwentyE | null = null
  skip: FibTwentyF | null = null
}

export class FibTwentyE {
  next: FibTwentyF | null = null
  skip: FibTwentyG | null = null
}

export class FibTwentyF {
  next: FibTwentyG | null = null
  skip: FibTwentyH | null = null
}

export class FibTwentyG {
  next: FibTwentyH | null = null
  skip: FibTwentyI | null = null
}

export class FibTwentyH {
  next: FibTwentyI | null = null
  skip: FibTwentyJ | null = null
}

export class FibTwentyI {
  next: FibTwentyJ | null = null
  skip: FibTwentyK | null = null
}

export class FibTwentyJ {
  next: FibTwentyK | null = null
  skip: FibTwentyL | null = null
}

export class FibTwentyK {
  next: FibTwentyL | null = null
  skip: FibTwentyM | null = null
}

export class FibTwentyL {
  next: FibTwentyM | null = null
  skip: FibTwentyN | null = null
}

export class FibTwentyM {
  next: FibTwentyN | null = null
  skip: FibTwentyO | null = null
}

export class FibTwentyN {
  next: FibTwentyO | null = null
  skip: FibTwentyP | null = null
}

export class FibTwentyO {
  next: FibTwentyP | null = null
  skip: FibTwentyQ | null = null
}

export class FibTwentyP {
  next: FibTwentyQ | null = null
  skip: FibTwentyR | null = null
}

export class FibTwentyQ {
  next: FibTwentyR | null = null
  skip: FibTwentyS | null = null
}

export class FibTwentyR {
  next: FibTwentyS | null = null
  skip: FibTwentyT | null = null
}

export class FibTwentyS {
  next: FibTwentyT | null = null
}

export class FibTwentyT {
  root: FibTwentyA | null = null
}

function fibTwenty(): FibTwentyA {
  const t = new FibTwentyT()
  t.root = new FibTwentyA()
  const s = new FibTwentyS()
  s.next = t
  const r = new FibTwentyR()
  r.next = s
  r.skip = t
  const q = new FibTwentyQ()
  q.next = r
  q.skip = s
  const p = new FibTwentyP()
  p.next = q
  p.skip = r
  const o = new FibTwentyO()
  o.next = p
  o.skip = q
  const n = new FibTwentyN()
  n.next = o
  n.skip = p
  const m = new FibTwentyM()
  m.next = n
  m.skip = o
  const l = new FibTwentyL()
  l.next = m
  l.skip = n
  const k = new FibTwentyK()
  k.next = l
  k.skip = m
  const j = new FibTwentyJ()
  j.next = k
  j.skip = l
  const i = new FibTwentyI()
  i.next = j
  i.skip = k
  const h = new FibTwentyH()
  h.next = i
  h.skip = j
  const g = new FibTwentyG()
  g.next = h
  g.skip = i
  const f = new FibTwentyF()
  f.next = g
  f.skip = h
  const e = new FibTwentyE()
  e.next = f
  e.skip = g
  const d = new FibTwentyD()
  d.next = e
  d.skip = f
  const c = new FibTwentyC()
  c.next = d
  c.skip = e
  const b = new FibTwentyB()
  b.next = c
  b.skip = d
  const a = new FibTwentyA()
  a.next = b
  a.skip = c
  return a
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
  // each is in the cycle through the last, and refers to it only through the next two
  fibTwenty: os.handler((): FibTwentyA => fibTwenty()),
}
