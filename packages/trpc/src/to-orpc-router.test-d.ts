import type {
  InferRouterInitialContext,
  InferRouterInputs,
  Lazyable,
  Procedure,
  Router,
  RouterClient,
  Schema,
} from '@orpc/server'
import { unlazy } from '@orpc/server'
import type { AsyncIteratorClass } from '@orpc/shared'
import { initTRPC, lazy, tracked, TRPCError } from '@trpc/server'
import type { TrackedData } from '@trpc/server/unstable-core-do-not-import'
import * as z from 'zod'

import { toORPCRouter } from './to-orpc-router'

type TRPCContext = { a: string }

const inputSchema = z.object({ input: z.number().transform((n) => `${n}`) })

const outputSchema = z.object({ output: z.number().transform((n) => `${n}`) })

const t = initTRPC.context<(req: Request) => TRPCContext>().create()

const trpcRouter = t.router({
  ping: t.procedure
    .input(inputSchema)
    .output(outputSchema)
    .query(({ input }) => {
      return { output: Number(input.input) }
    }),

  throw: t.procedure.input(z.object({ b: z.number(), c: z.string() })).query(() => {
    throw new TRPCError({
      code: 'PARSE_ERROR',
      message: 'throw',
    })
  }),

  subscribe: t.procedure.input(z.object({ u: z.string() })).subscription(async function* () {
    yield 'pong'
    yield tracked('id-1', { order: 1 })
  }),

  nested: {
    ping: t.procedure
      .input(z.object({ a: z.string() }))
      .output(z.string().transform((val) => Number(val)))
      .query(({ input }) => {
        return `1234${input.a}`
      }),
  },

  lazy: lazy(() =>
    Promise.resolve({
      default: t.router({
        subscribe: t.procedure.subscription(async function* () {
          yield 'pong'
        }),

        lazy: lazy(() =>
          Promise.resolve({
            default: t.router({
              throw: t.procedure
                .input(inputSchema)
                .output(outputSchema)
                .query(() => {
                  throw new Error('lazy.lazy.throw')
                }),
            }),
          }),
        ),
      }),
    }),
  ),
})

describe('toORPCRouter', () => {
  const orpcRouter = toORPCRouter(trpcRouter)

  expectTypeOf(orpcRouter).toExtend<Router<TRPCContext>>()

  expectTypeOf<InferRouterInitialContext<typeof orpcRouter>>().toEqualTypeOf<{ a: string }>()

  expectTypeOf(orpcRouter.ping).toEqualTypeOf<
    Procedure<
      TRPCContext,
      object,
      Schema<{ input: number }, unknown>,
      Schema<unknown, { output: string }>,
      object
    >
  >()

  expectTypeOf(orpcRouter.throw).toEqualTypeOf<
    Procedure<
      TRPCContext,
      object,
      Schema<{ b: number; c: string }, unknown>,
      Schema<unknown, never>,
      object
    >
  >()

  expectTypeOf(orpcRouter.subscribe).toEqualTypeOf<
    Procedure<
      TRPCContext,
      object,
      Schema<{ u: string }, unknown>,
      Schema<unknown, AsyncIteratorClass<'pong' | TrackedData<{ order: number }>, void, any>>,
      object
    >
  >()

  // tRPC erases `lazy()` in router types, so every nested router is typed as `Lazyable`
  expectTypeOf(orpcRouter.nested).toEqualTypeOf<
    Lazyable<{
      ping: Procedure<
        TRPCContext,
        object,
        Schema<{ a: string }, unknown>,
        Schema<unknown, number>,
        object
      >
    }>
  >()

  expectTypeOf(orpcRouter.lazy).toEqualTypeOf<
    Lazyable<{
      subscribe: Procedure<
        TRPCContext,
        object,
        Schema<void, unknown>,
        Schema<unknown, AsyncIteratorClass<string, void, any>>,
        object
      >
      lazy: Lazyable<{
        throw: Procedure<
          TRPCContext,
          object,
          Schema<{ input: number }, unknown>,
          Schema<unknown, { output: string }>,
          object
        >
      }>
    }>
  >()

  it('requires unlazy before accessing nested routers', async () => {
    // @ts-expect-error may be a lazy router at runtime
    void orpcRouter.lazy.subscribe

    const { default: lazyRouter } = await unlazy(orpcRouter.lazy)
    expectTypeOf(lazyRouter.subscribe).toEqualTypeOf<
      Procedure<
        TRPCContext,
        object,
        Schema<void, unknown>,
        Schema<unknown, AsyncIteratorClass<string, void, any>>,
        object
      >
    >()
  })

  it('works with router utilities', () => {
    const client = {} as RouterClient<typeof orpcRouter>

    expectTypeOf(client.nested.ping).parameter(0).toEqualTypeOf<{ a: string }>()
    expectTypeOf(client.nested.ping).returns.resolves.toEqualTypeOf<number>()
    expectTypeOf(client.lazy.lazy.throw).parameter(0).toEqualTypeOf<{ input: number }>()
    expectTypeOf(client.lazy.lazy.throw).returns.resolves.toEqualTypeOf<{ output: string }>()

    expectTypeOf<InferRouterInputs<typeof orpcRouter>['lazy']['lazy']['throw']>().toEqualTypeOf<{
      input: number
    }>()
  })
})
