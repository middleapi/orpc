// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import type { PartialDeep, ReadonlyDeep } from 'type-fest'
import * as z from 'zod'

export interface Page<T> {
  items: T[]
  total: number
}

function makeItem() {
  return { id: 'a', title: 't' }
}
type Item = ReturnType<typeof makeItem>
const ProductSchema = z.object({ id: z.string(), price: z.number() })
type Product = z.infer<typeof ProductSchema>

export const aliasArguments = {
  a: os.handler((): Page<Item> => ({ items: [makeItem()], total: 1 })),
  b: os.handler((): Page<Product> => ({ items: [], total: 0 })),
  c: os.handler((): Product => ({ id: 'a', price: 1 })),
  d: os.handler((): Page<Pick<Product, 'id'>> => ({ items: [], total: 0 })),
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
interface User {
  id: string
  name: string
  manager?: User
}
type UserPatch = PartialDeep<User>

export const deepViews = {
  a: os.input(type<PartialDeep<Comment>>()).handler(() => 1),
  b: os.input(type<PartialDeep<MenuItem>>()).handler(() => 1),
  c: os.input(type<UserPatch>()).handler(() => 1),
  d: os.handler((): ReadonlyDeep<Comment> => ({ id: 'a', replies: [] })),
}

const MODES = ['on', 'off'] as const
type Switch = (typeof MODES)[number]
type Mode = 'fast' | 'slow'
export const Status = { A: 'a', B: 'b' } as const
export type Status = (typeof Status)[keyof typeof Status]

export const literalAliases = {
  m: os.handler((): { mode: Mode; sw: Switch; st: Status } => ({
    mode: 'fast',
    sw: 'on',
    st: 'a',
  })),
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

export const queries = {
  q: os
    .route({ method: 'GET', path: '/q' })
    .input(type<{ tag?: string | string[]; tags?: string[] }>())
    .handler(({ input }) => input),
  f: os
    .route({ method: 'GET', path: '/f' })
    .input(
      z.object({
        minPrice: z.coerce.number().optional(),
        page: z.coerce.number().int().default(1),
      }),
    )
    .handler(({ input }) => input),
  d: os
    .route({ method: 'GET', path: '/d', inputStructure: 'detailed' })
    .input(type<{ query: Record<string, string | string[]> }>())
    .handler(({ input }) => Object.keys(input.query)),
  cursor: os
    .route({ method: 'GET', path: '/m/cursor' })
    .input(type<{ cursor: string | null; tags: string[] }>())
    .handler(() => 1),
  filter: os
    .route({ method: 'GET', path: '/m/filter' })
    .input(type<{ filter: { a?: string; b?: number }; ids: string[] }>())
    .handler(() => 1),
  del: os
    .route({ method: 'DELETE', path: '/m/items/{id}' })
    .input(type<{ id: string }>())
    .handler(() => 1),
  multi: os
    .route({ method: 'POST', path: '/m/multipart-null' })
    .input(type<{ file: File; caption: string | null; extra: { a?: string }; list: number[] }>())
    .handler(() => 1),
}
