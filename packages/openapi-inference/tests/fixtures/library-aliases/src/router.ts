import { os, type } from '@orpc/server'
import type { Column, InferSelectModel, Selectable, Table } from 'fake-orm'

declare const users: Table<{
  id: Column<number>
  name: Column<string>
  bio: Column<string, true>
}>
declare const posts: Table<{ id: Column<number>; title: Column<string> }>

/** A registered user */
export type User = typeof users.$inferSelect
// a second alias of the same type, which keeps the name of the first one
export type UserRow = typeof users.$inferSelect
export type Post = InferSelectModel<typeof posts>

interface AccountTable {
  id: Column<number>
  handle: Column<string>
}
export type Account = Selectable<AccountTable>

// a generic alias of the project the compiler does not keep, as it resolves to another type
type Flatten<T> = T extends object ? { [K in keyof T]: T[K] } : T
interface ProfileRow {
  userId: number
  website: string
}
export type Profile = Flatten<ProfileRow>

export type Settings = Readonly<{ theme: string; compact: boolean }>

// an alias the compiler keeps
export type Kept = { id: number; label: string }

export interface Paginated<T> {
  items: T[]
  total: number
}

export interface PostWithAuthor {
  post: Post
  author: User
  reviewer: UserRow | null
}

export const router = {
  users: os.handler(async (): Promise<User[]> => []),
  user: os.handler(async (): Promise<UserRow> => ({ id: 1, name: 'a', bio: null })),
  posts: os.handler((): Paginated<Post> => ({ items: [], total: 0 })),
  postWithAuthor: os.handler((): PostWithAuthor => ({
    post: { id: 1, title: 't' },
    author: { id: 1, name: 'a', bio: null },
    reviewer: null,
  })),
  createUser: os.input(type<User>()).handler(({ input }) => input.id),
  accounts: os.handler((): Account[] => []),
  profile: os.handler((): { profile: Profile; settings: Settings } => ({
    profile: { userId: 1, website: 'w' },
    settings: { theme: 'dark', compact: false },
  })),
  kept: os.handler((): Kept[] => []),
}
