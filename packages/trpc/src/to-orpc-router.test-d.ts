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
    Procedure<TRPCContext, object, Schema<{ input: number }, unknown>, Schema<unknown, { output: string }>, object, never>
  >()

  expectTypeOf(orpcRouter.throw).toEqualTypeOf<
    Procedure<TRPCContext, object, Schema<{ b: number, c: string }, unknown>, Schema<unknown, never>, object, never>
  >()

  expectTypeOf(orpcRouter.subscribe).toEqualTypeOf<
    Procedure<TRPCContext, object, Schema<{ u: string }, unknown>, Schema<unknown, AsyncIteratorClass<'pong' | TrackedData<{ order: number }>, void, any>>, object, never>
  >()

  expectTypeOf(orpcRouter.nested).toEqualTypeOf<
    {
      ping: Procedure<TRPCContext, object, Schema<{ a: string }, unknown>, Schema<unknown, number>, object, never>
    }
  >()

  expectTypeOf(orpcRouter.lazy).toEqualTypeOf<
    {
      subscribe: Procedure<TRPCContext, object, Schema<void, unknown>, Schema<unknown, AsyncIteratorClass<string, void, any>>, object, never>
      lazy: {
        throw: Procedure<TRPCContext, object, Schema<{ input: number }, unknown>, Schema<unknown, { output: string }>, object, never>
      }
    }
  >()
})
