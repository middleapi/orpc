// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { eventIterator, os, type } from '@orpc/server'
import * as z from 'zod'

import type { Tag } from './round11/contract'
import { impl } from './round11/contract'
import * as all from './round11/index'
import { healthPing, pings } from './round11/index'
import { getUser } from './round11/users'

const list = impl.users.list.handler(() => [])

const Category = z.object({
  name: z.string().optional(),
  get children(): z.ZodArray<typeof Category> {
    return z.array(Category)
  },
})

/* oxlint-disable typescript/no-duplicate-enum-values -- duplicate values, which zod's enum keeps */
enum Status {
  Active = 'a',
  Alias = 'a',
  Closed = 'c',
}
/* oxlint-enable typescript/no-duplicate-enum-values */

const procedures = {
  /** Requires a signed-in user */
  authed: os.use(({ next }) => next()),
}

const helpers = {
  /** Wraps a procedure with auth checks */
  withAuth: <T>(procedure: T) => procedure,
}

function makeProcedures<TContext extends object>() {
  return {
    /** Requires a signed-in user, from a generic factory */
    authed: os.$context<TContext>().use(({ next }) => next()),
  }
}

const getMe = procedures.authed.handler(() => 'me')
const getGeneric = makeProcedures<{ user?: string }>().authed.handler(() => 'me')
const secret = helpers.withAuth(os.handler(() => 'secret'))

/**
 * JSDoc read through variables holding implemented procedures, and namespace members
 */
export const jsdoc = {
  users: impl.users.router({ get: getUser, list }),
  ns: pings.ping,
  star: all.healthPing,
  healthPing,
  getMe,
  getGeneric,
  secret,
}

/**
 * Slots mixing schemas a converter supports with type-only ones
 */
export const mixed = {
  input: os
    .input(z.object({ a: z.string().min(3) }))
    .input(type<{ b: number }>())
    .handler(() => 'ok'),
  output: os
    .output(z.object({ a: z.string().min(3) }))
    .output(type<{ b: number }>())
    .handler(() => ({ a: 'abc', b: 1 })),
  iterator: os
    .output(eventIterator(z.object({ id: z.string().min(2) }), type<{ total: number }>()))
    .handler(async function* () {
      yield { id: 'ab' }
      return { total: 1 }
    }),
  query: os
    .route({ method: 'GET' })
    .input(z.object({ a: z.string().min(3) }))
    .input(type<{ b: number }>())
    .handler(() => 'ok'),
  iterators: os
    .output(eventIterator(z.object({ id: z.string().min(2) })))
    .output(eventIterator(type<{ n: number }>()))
    .handler(async function* () {
      yield { id: 'ab', n: 1 }
    }),
  detailed: os
    .route({ method: 'POST', path: '/detailed/{id}', inputStructure: 'detailed' })
    .input(z.object({ params: z.object({ id: z.string() }), query: z.object({ a: z.string() }) }))
    .input(type<{ query: { b: number } }>())
    .handler(() => 'ok'),
  nested: os
    .input(z.object({ user: z.object({ name: z.string() }) }))
    .input(type<{ user: { age: number } }>())
    .handler(() => 'ok'),
  sameRef: os
    .input(z.object({ tag: z.unknown().meta({ id: 'Tag' }) }))
    .input(type<{ tag: Tag; b: number }>())
    .handler(() => 'ok'),
  optionalInZod: os
    .input(z.object({ a: z.string().optional() }))
    .input(type<{ a: string; b: number }>())
    .handler(() => 'ok'),
  constraints: os
    .input(z.object({ id: z.string() }))
    .input(type<{ id: `user_${string}`; b: number }>())
    .handler(() => 'ok'),
  queryDefault: os
    .route({ method: 'GET' })
    .input(z.object({ lim: z.coerce.number().default(10) }))
    .input(type<{ lim: number; extra: string }>())
    .handler(() => 'ok'),
  queryEnum: os
    .route({ method: 'GET' })
    .input(z.object({ s: z.enum(['archived', 'active']) }))
    .input(type<{ s: 'active' | 'archived'; extra: string }>())
    .handler(() => 'ok'),
  queryRequired: os
    .route({ method: 'GET' })
    .input(z.object({ a: z.string().optional() }))
    .input(type<{ a: string; b: string }>())
    .handler(() => 'ok'),
  queryNullableEnum: os
    .route({ method: 'GET' })
    .input(z.object({ s: z.enum(['b', 'a']).nullable() }))
    .input(type<{ s: 'a' | 'b' | null; extra: string }>())
    .handler(() => 'ok'),
  queryDuplicateEnum: os
    .route({ method: 'GET' })
    .input(z.object({ s: z.enum(Status) }))
    .input(type<{ s: Status; extra: string }>())
    .handler(() => 'ok'),
  queryConst: os
    .route({ method: 'GET' })
    .input(z.object({ s: z.enum(['a']) }))
    .input(type<{ s: 'a'; extra: string }>())
    .handler(() => 'ok'),
  recursive: os
    .input(Category)
    .input(type<{ name: string; extra: number }>())
    .handler(() => 'ok'),
  weaker: os
    .input(z.object({ tag: z.unknown() }))
    .input(type<{ tag: Tag; b: number }>())
    .handler(() => 'ok'),
}

async function* genA() {
  yield { a: 1 }
}

async function* genB() {
  yield { b: 'x' }
}

/**
 * Unions of event iterators
 */
async function* genC() {
  yield { c: true }
  return { total: 1 }
}

export const streams = {
  partialReturn: os.input(type<boolean>()).handler(({ input }) => (input ? genA() : genC())),
  union: os.input(type<boolean>()).handler(({ input }) => (input ? genA() : genB())),
  nullable: os.input(type<boolean>()).handler(({ input }) => (input ? genA() : undefined)),
}
