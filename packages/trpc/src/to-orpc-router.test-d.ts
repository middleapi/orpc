import type { InferRouterInitialContext, Procedure, Router, Schema } from '@orpc/server'
import type { AsyncIteratorClass } from '@orpc/shared'
import type { inferRouterContext } from '@trpc/server'
import type { TrackedData } from '@trpc/server/unstable-core-do-not-import'
import type { TRPCContext, trpcRouter } from '../tests/shared'
import type { ToORPCRouterResult } from './to-orpc-router'

it('ToORPCRouterResult', () => {
  const orpcRouter = {} as ToORPCRouterResult<
    inferRouterContext<typeof trpcRouter>,
    typeof trpcRouter['_def']['record']
  >

  expectTypeOf(orpcRouter).toExtend<Router<TRPCContext>>()

  expectTypeOf<InferRouterInitialContext<typeof orpcRouter>>().toEqualTypeOf<{ a: string }>()

  expectTypeOf(orpcRouter.ping).toEqualTypeOf<
    Procedure<TRPCContext, object, Schema<{ input: number }, unknown>, Schema<unknown, { output: string }>, Record<never, never>, never>
  >()

  expectTypeOf(orpcRouter.throw).toEqualTypeOf<
    Procedure<TRPCContext, object, Schema<{ b: number, c: string }, unknown>, Schema<unknown, never>, Record<never, never>, never>
  >()

  expectTypeOf(orpcRouter.subscribe).toEqualTypeOf<
    Procedure<TRPCContext, object, Schema<{ u: string }, unknown>, Schema<unknown, AsyncIteratorClass<'pong' | TrackedData<{ order: number }>, void, any>>, Record<never, never>, never>
  >()

  expectTypeOf(orpcRouter.nested).toEqualTypeOf<
    {
      ping: Procedure<TRPCContext, object, Schema<{ a: string }, unknown>, Schema<unknown, number>, Record<never, never>, never>
    }
  >()

  expectTypeOf(orpcRouter.lazy).toEqualTypeOf<
    {
      subscribe: Procedure<TRPCContext, object, Schema<void, unknown>, Schema<unknown, AsyncIteratorClass<string, void, any>>, Record<never, never>, never>
      lazy: {
        throw: Procedure<TRPCContext, object, Schema<{ input: number }, unknown>, Schema<unknown, { output: string }>, Record<never, never>, never>
      }
    }
  >()
})
