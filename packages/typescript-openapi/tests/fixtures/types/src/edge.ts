// @ts-expect-error the module does not exist
import type { Missing } from '@/missing'
import type { User as OtherUser } from '@/other/user'
import type { User } from '@/shared/user'

export interface BothUsers {
  user: User
  other: OtherUser
}

export interface WithMissing {
  missing: Missing
}

export type Gen = AsyncGenerator<{ n: number }, 'done', void>
export type Iter = AsyncIterable<string>
export type IterObject = AsyncIteratorObject<number, void>
export type NotIter = Iterable<string>

/** A union of async iterators, with `undefined` */
export type GenOrNull = Gen | AsyncGenerator<string> | undefined

/** An iterator whose `next()` has several results that are not done */
export interface ManyResults {
  [Symbol.asyncIterator](): {
    next(): Promise<
      | { done: false; value: { a: number } }
      | { done: false; value: { b: string } }
      | { done: true; value: undefined }
    >
  }
}
