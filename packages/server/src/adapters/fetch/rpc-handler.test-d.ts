import { onError, onFinish } from '@orpc/shared'

import { os } from '../../builder'
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
