import { onError, onFinish } from '@orpc/shared'

import { os } from '../../builder'
import type { InferRouterInitialContext } from '../../router'
import { RPCHandler } from './rpc-handler'

const router = {
  ping: os.handler(() => 'pong'),
}

it('infers the error type of onError and onFinish in handler interceptors', () => {
  const _handler = new RPCHandler(router, {
    routingInterceptors: [
      onError((error) => {
        expectTypeOf(error).toEqualTypeOf<unknown>()
      }),
    ],
    interceptors: [
      onError((error) => {
        expectTypeOf(error).toEqualTypeOf<unknown>()
      }),
      onFinish(([error, , isSuccess]) => {
        if (!isSuccess) {
          expectTypeOf(error).toEqualTypeOf<unknown>()
        } else {
          expectTypeOf(error).toEqualTypeOf<null>()
        }
      }),
    ],
  })
})

it('needs an explicit initial context for a router mixing unrelated initial contexts', () => {
  const router = {
    a: os.$context<{ a: string }>().handler(() => 'a'),
    b: os.$context<{ b: number }>().handler(() => 'b'),
  }

  // class type-param inference picks one candidate instead of intersecting
  // @ts-expect-error - `{ b: number }` is missing from the inferred context
  void new RPCHandler(router)

  expectTypeOf(new RPCHandler<InferRouterInitialContext<typeof router>>(router)).toEqualTypeOf<
    RPCHandler<{ a: string } & object & { b: number }>
  >()
})

it('infers the initial context when one context extends the others', () => {
  const base = os.$context<{ a: string }>()
  const router = {
    a: base.handler(() => 'a'),
    b: base.$context<{ a: string; b: number }>().handler(() => 'b'),
  }

  expectTypeOf(new RPCHandler(router)).toEqualTypeOf<
    RPCHandler<{ a: string; b: number } & object>
  >()
})
