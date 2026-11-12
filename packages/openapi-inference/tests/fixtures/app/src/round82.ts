// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import type { PartialDeep, ReadonlyDeep } from 'type-fest'
import * as z from 'zod'

import type { Box } from './round82-lib'

export interface Page<T> {
  items: T[]
  total: number
}

export interface ApiResponse<T> {
  data: T
}

function toItem() {
  return { id: 'a', title: 't' }
}
type Item = ReturnType<typeof toItem>
const ProductSchema = z.object({ id: z.string(), price: z.number() })
type Product = z.infer<typeof ProductSchema>

class UserService {
  toPublic() {
    return { id: 'u', email: 'e' }
  }

  async summary() {
    return { id: 'u', lines: 1 }
  }
}
const users = new UserService()
type PublicUser = ReturnType<UserService['toPublic']>
type Summary = Awaited<ReturnType<typeof users.summary>>

/** Instantiations over models whose types lost the aliases naming them */
export const roundEightyTwoNames = {
  items: os.handler((): Page<Item> => ({ items: [toItem()], total: 1 })),
  products: os.handler((): Page<Product> => ({ items: [], total: 0 })),
  product: os.handler((): Product => ({ id: 'a', price: 1 })),
  picked: os.handler((): Page<Pick<Product, 'id'>> => ({ items: [], total: 0 })),
  publicUsers: os.handler((): ApiResponse<Page<PublicUser>> => ({
    data: { items: [users.toPublic()], total: 1 },
  })),
  summaries: os.handler(async (): Promise<Page<Summary>> => ({
    items: [await users.summary()],
    total: 1,
  })),
  // an object literal without an alias, by its keys
  literal: os.handler((): Page<{ id: string; title: string; done: boolean }> => ({
    items: [],
    total: 0,
  })),
}

interface Comment {
  id: string
  replies: Comment[]
  parent?: Comment
}
interface MenuItem {
  label: string
  items?: MenuItem[]
  parent?: MenuItem
}
interface Person {
  id: string
  name: string
  manager?: Person
}
type PersonPatch = PartialDeep<Person>

/** Deep views of type-fest of recursive models */
export const roundEightyTwoDeepViews = {
  comment: os.input(type<PartialDeep<Comment>>()).handler(() => 1),
  menuItem: os.input(type<PartialDeep<MenuItem>>()).handler(() => 1),
  personPatch: os.input(type<PersonPatch>()).handler(() => 1),
  readonlyComment: os.handler((): ReadonlyDeep<Comment> => ({ id: 'a', replies: [] })),
}

const MODES = ['on', 'off'] as const
type Switch = (typeof MODES)[number]
type Mode = 'fast' | 'slow'
export const Level = { Low: 'low', High: 'high' } as const
export type Level = (typeof Level)[keyof typeof Level]
const ROLES = ['owner', 'member', 'guest'] as const
type TeamRole = (typeof ROLES)[number]
interface Member {
  role: TeamRole
}

/** Aliases of unions of literals, also of the items of an `as const` array */
export const roundEightyTwoLiterals = {
  settings: os.handler((): { mode: Mode; sw: Switch; level: Level; next?: Switch } => ({
    mode: 'fast',
    sw: 'on',
    level: 'low',
  })),
  member: os.handler((): Member => ({ role: 'owner' })),
  // the same union written in place keeps the alias, as for object models
  inPlace: os.handler((): 'on' | 'off' => 'on'),
}

type Role = 'admin' | 'member'
interface Account {
  role: Role
}

/** A type as a query parameter, a body and a response */
export const roundEightyTwoRoles = {
  list: os
    .route({ method: 'GET', path: '/list' })
    .input(type<{ role?: Role }>())
    .handler((): Role[] => []),
  create: os.input(type<{ role: Role }>()).handler(({ input }) => input.role),
  account: os.input(type<Account>()).handler((): Account => ({ role: 'admin' })),
}

/** Outputs a converter documents as any value, or throws on */
export const roundEightyTwoConverted = {
  transformed: os
    .output(z.object({ slug: z.string() }).transform((c) => ({ ...c, n: 1 })))
    .handler(() => ({ slug: 's' })),
  kept: os.output(z.object({ slug: z.string().min(1) })).handler(() => ({ slug: 's' })),
  unknown: os.output(z.unknown()).handler((): unknown => 1),
}

/** A model of a declaration file importing a module that is not installed */
export const roundEightyTwoUnresolved = {
  box: os.handler((): Box => ({ label: 'b', inner: {} as never })),
}

type Created =
  | { status: 201; headers: { location: string }; body: { id: string } }
  | { status: 200; body: { id: string } }

/** Detailed outputs whose members leave out a status, headers or a body */
export const roundEightyTwoDetailed = {
  // `{ body: 2 }` is `{ status?: undefined; body: number }` in the union
  mixed: os
    .route({ method: 'POST', path: '/mixed', outputStructure: 'detailed' })
    .input(type<{ explicit?: boolean }>())
    .handler(({ input }) => (input.explicit ? { status: 202 as const, body: 1 } : { body: 2 })),
  created: os
    .route({ method: 'POST', path: '/created', outputStructure: 'detailed' })
    .input(type<{ explicit?: boolean }>())
    .handler(({ input }): Created =>
      input.explicit
        ? { status: 201, headers: { location: '/a' }, body: { id: 'a' } }
        : { status: 200, body: { id: 'a' } },
    ),
  sameStatus: os
    .route({ method: 'POST', path: '/sameStatus', outputStructure: 'detailed' })
    .input(type<{ explicit?: boolean }>())
    .handler(
      ({
        input,
      }):
        | { status: 200; headers: { 'x-a': string }; body: string }
        | { status: 200; body: string } =>
        input.explicit
          ? { status: 200, headers: { 'x-a': '1' }, body: 'a' }
          : { status: 200, body: 'b' },
    ),
  etag: os
    .route({ method: 'POST', path: '/etag', outputStructure: 'detailed' })
    .input(type<{ explicit?: boolean }>())
    .handler(({ input }) =>
      input.explicit
        ? { status: 304 as const, headers: { etag: 'v1' } }
        : { status: 200 as const, headers: { etag: 'v1' }, body: { id: '', v: 1 } },
    ),
}

/** Event iterators returning nothing */
export const roundEightyTwoStreams = {
  annotated: os.handler(async function* (): AsyncGenerator<{ m: string }, void, unknown> {
    yield { m: '' }
  }),
  returnsUndefined: os.handler(async function* () {
    yield { m: '' }
    return undefined
  }),
}

/** Requests a client sends without the parts these fields would be in */
export const roundEightyTwoRequests = {
  remove: os
    .route({ method: 'DELETE', path: '/items/{id}' })
    .input(type<{ id: string }>())
    .handler(() => 1),
  record: os
    .route({ method: 'GET', path: '/record', inputStructure: 'detailed' })
    .input(type<{ query: Record<string, string> }>())
    .handler(({ input }) => Object.keys(input.query).length),
}
