import type { DecoratedLazy } from './lazy-decorated'
import type { Middleware } from './middleware'
import type { AdaptedRouter } from './router-builder'
import type { RouterImplementer } from './router-implementer'
import { oc } from '@orpc/contract'
import { z } from 'zod'
import { lazy } from './lazy'
import { Procedure } from './procedure'

const schema = z.object({ val: z.string().transform(val => Number(val)) })

const ping = oc.input(schema).output(schema)
const pong = oc.route({ method: 'GET', path: '/ping' })

const contract = oc.router({
  ping,
  pong,
  nested: {
    ping,
    pong,
  },
})

const pingImpl = new Procedure({
  contract: ping,
  handler: vi.fn(),
})

const pongImpl = new Procedure({
  contract: pong,
  handler: vi.fn(),
})

const router = {
  ping: pingImpl,
  pong: pongImpl,
  nested: {
    ping: pingImpl,
    pong: pongImpl,
  },
}

const routerWithLazy = {
  ping: lazy(() => Promise.resolve({ default: pingImpl })),
  pong: pongImpl,
  nested: lazy(() => Promise.resolve({
    default: {
      ping: pingImpl,
      pong: lazy(() => Promise.resolve({ default: pongImpl })),
    },
  })),
}

const implementer = {} as RouterImplementer<{ auth: boolean }, { db: string }, typeof contract>

describe('self chainable', () => {
  it('use middleware', () => {
    const mid1 = {} as Middleware<{ auth: boolean }, undefined, unknown, unknown>
    const mid2 = {} as Middleware<{ auth: boolean }, { dev: string }, unknown, unknown>
    const mid3 = {} as Middleware<{ auth: boolean, db: string }, { dev: string }, unknown, unknown>

    expectTypeOf(implementer.use(mid1)).toEqualTypeOf<typeof implementer>()
    expectTypeOf(implementer.use(mid2)).toEqualTypeOf<
      RouterImplementer<{ auth: boolean }, { db: string } & { dev: string }, typeof contract>
    >()
    expectTypeOf(implementer.use(mid3)).toEqualTypeOf<
      RouterImplementer<{ auth: boolean }, { db: string } & { dev: string }, typeof contract>
    >()

    const mid4 = {} as Middleware<{ auth: boolean }, { dev: string }, unknown, { val: string }>
    const mid5 = {} as Middleware<{ auth: boolean }, { dev: string }, unknown, { val: number }>
    const mid6 = {} as Middleware<{ auth: 'invalid' }, undefined, any, any>

    // @ts-expect-error - invalid middleware
    implementer.use(mid4)
    // @ts-expect-error - invalid middleware
    implementer.use(mid5)
    // @ts-expect-error - invalid middleware
    implementer.use(mid6)
    // @ts-expect-error - invalid middleware
    implementer.use(true)
    // @ts-expect-error - invalid middleware
    implementer.use(() => {})
  })
})

it('to AdaptedRouter', () => {
  expectTypeOf(implementer.router(router)).toMatchTypeOf<
    AdaptedRouter<{ auth: boolean }, typeof router>
  >()

  expectTypeOf(implementer.router(routerWithLazy)).toMatchTypeOf<
    AdaptedRouter<{ auth: boolean }, typeof routerWithLazy>
  >()
})

it('to AdaptedLazy', () => {
  expectTypeOf(implementer.lazy(() => Promise.resolve({ default: router }))).toMatchTypeOf<
    DecoratedLazy<AdaptedRouter<{ auth: boolean }, typeof router>>
  >()

  expectTypeOf(implementer.lazy(() => Promise.resolve({ default: routerWithLazy }))).toMatchTypeOf<
    DecoratedLazy<AdaptedRouter<{ auth: boolean }, typeof routerWithLazy>>
  >()
})
