import type { ANY_PROCEDURE, ANY_ROUTER, DecoratedProcedure, Procedure, ProcedureClient, WELL_CONTEXT } from '.'
import type { Lazy } from './lazy'
import type { DecoratedLazy } from './lazy-decorated'
import { z } from 'zod'
import { lazy } from './lazy'
import { decorateLazy } from './lazy-decorated'

const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })

const ping = {} as Procedure<WELL_CONTEXT, { db: string }, undefined, typeof schema, { val: string }>
const pong = {} as DecoratedProcedure<WELL_CONTEXT, undefined, typeof schema, undefined, unknown>

const lazyPing = lazy(() => Promise.resolve({ default: ping }))
const lazyPong = lazy(() => Promise.resolve({ default: pong }))

const router = {
  ping,
  pong,
  nested: {
    ping,
    pong,
  },
}

const lazyRouter = lazy(() => Promise.resolve({
  default: {
    ping: lazyPing,
    pong,
    nested: lazy(() => Promise.resolve({
      default: {
        ping,
        pong: lazyPong,
      },
    })),
  },
}))

describe('DecoratedLazy', () => {
  it('with procedure', () => {
    const decorated = {} as DecoratedLazy<typeof ping>

    expectTypeOf(decorated).toMatchTypeOf<Lazy<ANY_PROCEDURE>>()

    expectTypeOf(decorated).toMatchTypeOf<
      ProcedureClient<unknown, { val: number }, unknown>
    >()
  })

  it('with router', () => {
    const decorated = {} as DecoratedLazy<typeof router>

    expectTypeOf(decorated).toMatchTypeOf<Lazy<ANY_ROUTER>>()
    expectTypeOf({ router: decorated }).toMatchTypeOf<ANY_ROUTER>()

    expectTypeOf(decorated.ping).toMatchTypeOf<Lazy<ANY_PROCEDURE>>()
    expectTypeOf(decorated.ping).toMatchTypeOf<ProcedureClient<unknown, { val: number }, unknown>>()

    expectTypeOf(decorated.pong).toMatchTypeOf<Lazy<ANY_PROCEDURE>>()
    expectTypeOf(decorated.pong).toMatchTypeOf<ProcedureClient<{ val: string }, unknown, unknown>>()

    expectTypeOf(decorated.nested).toMatchTypeOf<Lazy<ANY_ROUTER>>()
    expectTypeOf({ router: decorated.nested }).toMatchTypeOf<ANY_ROUTER>()

    expectTypeOf(decorated.nested.ping).toMatchTypeOf<Lazy<ANY_PROCEDURE>>()
    expectTypeOf(decorated.nested.ping).toMatchTypeOf<ProcedureClient<unknown, { val: number }, unknown>>()

    expectTypeOf(decorated.nested.pong).toMatchTypeOf<Lazy<ANY_PROCEDURE>>()
    expectTypeOf(decorated.nested.pong).toMatchTypeOf<ProcedureClient<{ val: string }, unknown, unknown>>()
  })

  it('flat lazy', () => {
    expectTypeOf<DecoratedLazy<typeof lazyPing>>().toEqualTypeOf<DecoratedLazy<typeof ping>>()
    expectTypeOf<DecoratedLazy<typeof lazyPong>>().toEqualTypeOf<DecoratedLazy<typeof pong>>()
    expectTypeOf<DecoratedLazy<Lazy<typeof router>>>().toEqualTypeOf<DecoratedLazy<typeof router>>()

    expectTypeOf<DecoratedLazy<typeof lazyRouter>['ping']>().toEqualTypeOf<DecoratedLazy<typeof router>['ping']>()
    expectTypeOf<DecoratedLazy<typeof lazyRouter>['pong']>().toEqualTypeOf<DecoratedLazy<typeof router>['pong']>()
    expectTypeOf<DecoratedLazy<typeof lazyRouter>['nested']['ping']>().toEqualTypeOf<DecoratedLazy<typeof router>['nested']['ping']>()
    expectTypeOf<DecoratedLazy<typeof lazyRouter>['nested']['pong']>().toEqualTypeOf<DecoratedLazy<typeof router>['nested']['pong']>()

    // @ts-expect-error - lazy loader is diff
    expectTypeOf<DecoratedLazy<typeof lazyRouter>['nested']>().toEqualTypeOf<DecoratedLazy<typeof router>['nested']>()
  })

  it('not callable when context is required', () => {
    const d1 = {} as DecoratedLazy<typeof ping>
    const d2 = {} as DecoratedLazy<typeof router>
    const d3 = {} as DecoratedLazy<Procedure<undefined | { auth: boolean }, { db: string }, undefined, undefined, undefined>>
    const d4 = {} as DecoratedLazy<Procedure<{ auth: boolean }, { db: string }, undefined, undefined, undefined>>

    d1()
    d3()

    // @ts-expect-error --- cannot call on router level
    d2()
    // @ts-expect-error --- context is required
    d4()
  })
})

it('decorateLazy', () => {
  expectTypeOf(decorateLazy(lazyPing)).toEqualTypeOf<DecoratedLazy<typeof ping>>()
  expectTypeOf(decorateLazy(lazyPong)).toEqualTypeOf<DecoratedLazy<typeof pong>>()
  expectTypeOf(decorateLazy(lazy(() => Promise.resolve({ default: router })))).toEqualTypeOf<DecoratedLazy<typeof router>>()

  // @ts-expect-error - invalid lazy
  decorateLazy(ping)

  // @ts-expect-error - invalid lazy
  decorateLazy(router)
})
