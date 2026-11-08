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
