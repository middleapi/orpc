import { os } from '@orpc/server'

import type { Cents, LooseDeep } from './deep-partial-brands'

/** Fields typed by inline mapped types over keys without type parameters */
export class Tally {
  counts: { [key in string]: number } = { a: 1 }
  codes: { [key in `id-${string}`]: number } = { 'id-a': 1 }
  none: { [key in never]: number } = {}

  toJSON(): string {
    return 'tally'
  }
}

/** A mapped type changing every value, which is no view of its source */
export type Textual<T> = T extends object
  ? { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: string }
  : T

export const keyedMappedTypes = {
  textualTally: os.handler((): Textual<Tally> => ({ counts: 'a', codes: 'b', none: 'c' })),
  // every key of a deep partial type is optional, so a plain object is one too
  emptyLooseCents: os.handler((): LooseDeep<Cents> => ({})),
}
