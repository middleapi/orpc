import type { ORPCError } from './error'
import type { Client, ClientContext } from './types'
import { isDefinedError } from './error'
import { safe } from './utils'

describe('safe', async () => {
  const client = {} as Client<ClientContext, string, number, Error | ORPCError<'BAD_GATEWAY', { val: string }>>

  it('tuple style', async () => {
    const [error, data, isDefined, isSuccess] = await safe(client('123'))

    if (error || !isSuccess) {
      expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
      expectTypeOf(data).toEqualTypeOf<undefined>()
      expectTypeOf(isDefined).toEqualTypeOf<boolean>()

      if (isDefinedError(error)) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }

      if (isDefined) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }
      else {
        expectTypeOf(error).toEqualTypeOf<Error>()
      }
    }
    else {
      expectTypeOf(error).toEqualTypeOf<null>()
      expectTypeOf(data).toEqualTypeOf<number>()
      expectTypeOf(isDefined).toEqualTypeOf<false>()
    }
  })

  it('object style', async () => {
    const { error, data, isDefined, isSuccess } = await safe(client('123'))

    if (error || !isSuccess) {
      expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
      expectTypeOf(data).toEqualTypeOf<undefined>()
      expectTypeOf(isDefined).toEqualTypeOf<boolean>()

      if (isDefinedError(error)) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }

      if (isDefined) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }
      else {
        expectTypeOf(error).toEqualTypeOf<Error>()
      }
    }
    else {
      expectTypeOf(error).toEqualTypeOf<null>()
      expectTypeOf(data).toEqualTypeOf<number>()
      expectTypeOf(isDefined).toEqualTypeOf<false>()
    }
  })

  it('can catch Promise', async () => {
    const { error, data } = await safe({} as Promise<number>)

    expectTypeOf(error).toEqualTypeOf<Error | null>()
    expectTypeOf(data).toEqualTypeOf<number | undefined>()
  })
})
