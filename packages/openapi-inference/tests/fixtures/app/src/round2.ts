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
