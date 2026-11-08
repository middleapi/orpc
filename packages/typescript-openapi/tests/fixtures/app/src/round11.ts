import { eventIterator, os, type } from '@orpc/server'
import * as z from 'zod'

import { impl } from './round11/contract'
import * as all from './round11/index'
import { healthPing, pings } from './round11/index'
import { getUser } from './round11/users'

const list = impl.users.list.handler(() => [])

/**
 * JSDoc read through variables holding implemented procedures, and namespace members
 */
export const jsdoc = {
  users: impl.users.router({ get: getUser, list }),
  ns: pings.ping,
  star: all.healthPing,
  healthPing,
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
}
