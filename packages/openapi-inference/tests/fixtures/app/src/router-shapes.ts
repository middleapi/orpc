// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { openapi } from '@orpc/openapi'
import { os, type } from '@orpc/server'

const procedure = os.input(type<{ a: string }>()).handler(() => ({ ok: true }))

const dev = Math.random() > 2

export const records: { planets: Record<string, typeof procedure> } = {
  planets: { a: procedure },
}

export const optional: { ping: typeof procedure; nested?: { a: typeof procedure } } = {
  ping: procedure,
  nested: { a: procedure },
}

export const spread = { ping: procedure, ...(dev ? { debug: procedure } : {}) }

const on = Math.random() < 2

export const other = os.handler(() => ({ b: 'x' }))

// of variables, as the members of a union of object literals get the keys of the others
const base = { ping: procedure }
const routerA = { ping: procedure, shared: procedure }
const routerB = { other, shared: other }

export const unions = on ? { ...base, debug: other } : base

export const disjoint = on ? routerA : routerB

export const indexes: {
  versions: Record<`v${number}`, typeof procedure>
  numbers: Record<number, typeof other>
} = { versions: { v1: procedure }, numbers: { 0: other } }

export const lazyRouter = {
  api: os.lazy(async () => ({
    default: { ping: procedure, nested: { pong: procedure, other } },
  })),
}

export const notProcedures = { ping: 'not a procedure', nested: { pong: 42 } }

export interface FindQuery {
  limit?: number
  search: string
}

export interface Created {
  status: 201
  body: { id: string }
}
export interface Accepted {
  status: 202
  body: { queued: true }
}

export const decomposed = {
  grp: os.meta(openapi({ tags: ['grp'] })).router({
    /**
     * Find things
     * @tags fromdoc
     */
    find: os
      .route({ method: 'GET', path: '/things' })
      .input(type<FindQuery>())
      .handler(() => [] as string[]),
  }),
  create: os
    .route({ method: 'POST', path: '/things', outputStructure: 'detailed' })
    .handler((): Created | Accepted => ({ status: 201, body: { id: '1' } })),
}
