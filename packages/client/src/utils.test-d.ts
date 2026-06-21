import type { PromiseWithError } from '@orpc/shared'
import type { ORPCError } from './error'
import type { Client, ClientContext } from './types'
import { isInferableError } from './error-utils'
import { consumeEventIterator, safe } from './utils'

describe('safe', async () => {
  const client = {} as Client<ClientContext, string, number, Error | ORPCError<'BAD_GATEWAY', { val: string }>>

  it('tuple style', async () => {
    const [error, data, inferableError, isSuccess] = await safe(client('123'))

    if (error || !isSuccess) {
      expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
      expectTypeOf(data).toEqualTypeOf<undefined>()
      expectTypeOf(inferableError).toEqualTypeOf<null | ORPCError<'BAD_GATEWAY', { val: string }>>()

      if (isInferableError(error)) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }

      if (inferableError) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
        expectTypeOf(inferableError).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }
      else {
        // TODO: FIX IT - ORPCError should not showing here
        expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
        expectTypeOf(inferableError).toEqualTypeOf<null>()
      }
    }
    else {
      expectTypeOf(error).toEqualTypeOf<null>()
      expectTypeOf(data).toEqualTypeOf<number>()
      expectTypeOf(inferableError).toEqualTypeOf<null>()
    }
  })

  it('object style', async () => {
    const { error, data, inferableError, isSuccess } = await safe(client('123'))

    if (error || !isSuccess) {
      expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
      expectTypeOf(data).toEqualTypeOf<undefined>()
      expectTypeOf(inferableError).toEqualTypeOf<null | ORPCError<'BAD_GATEWAY', { val: string }>>()

      if (isInferableError(error)) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }

      if (inferableError) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
        expectTypeOf(inferableError).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }
      else {
        // TODO: FIX IT - ORPCError should not showing here
        expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
        expectTypeOf(inferableError).toEqualTypeOf<null>()
      }
    }
    else {
      expectTypeOf(error).toEqualTypeOf<null>()
      expectTypeOf(data).toEqualTypeOf<number>()
      expectTypeOf(inferableError).toEqualTypeOf<null>()
    }
  })

  it('support regular Promise', async () => {
    const { error, data } = await safe({} as Promise<number>)

    expectTypeOf(error).toEqualTypeOf<Error | null>()
    expectTypeOf(data).toEqualTypeOf<number | undefined>()
  })
})

describe('consumeEventIterator', () => {
  it('can infer types from PromiseWithError + AsyncGenerator', () => {
    void consumeEventIterator({} as PromiseWithError<AsyncGenerator<'message-value', 'done-value'>, 'error-value'>, {
      onEvent: (message) => {
        expectTypeOf(message).toEqualTypeOf<'message-value'>()
      },
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<'error-value'>()
      },
      onSuccess: (value) => {
        expectTypeOf(value).toEqualTypeOf<'done-value' | undefined>()
      },
      onFinish: ([error, data, isSuccess]) => {
        if (!error || isSuccess) {
          expectTypeOf(error).toEqualTypeOf<null>()
          expectTypeOf(data).toEqualTypeOf<'done-value' | undefined>()
        }
        else {
          expectTypeOf(error).toEqualTypeOf<'error-value'>()
          expectTypeOf(data).toEqualTypeOf<undefined>()
        }
      },
    })
  })

  it('can infer types from AsyncIterator', () => {
    void consumeEventIterator({} as AsyncIterator<'message-value', 'done-value'>, {
      onEvent: (message) => {
        expectTypeOf(message).toEqualTypeOf<'message-value'>()
      },
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<Error>()
      },
      onSuccess: (value) => {
        expectTypeOf(value).toEqualTypeOf<'done-value' | undefined>()
      },
      onFinish: ([error, data, isSuccess]) => {
        if (!error || isSuccess) {
          expectTypeOf(error).toEqualTypeOf<null>()
          expectTypeOf(data).toEqualTypeOf<'done-value' | undefined>()
        }
        else {
          expectTypeOf(error).toEqualTypeOf<Error>()
          expectTypeOf(data).toEqualTypeOf<undefined>()
        }
      },
    })
  })
})
