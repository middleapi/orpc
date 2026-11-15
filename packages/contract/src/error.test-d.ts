import type { ORPCError } from '@orpc/client'
import * as z from 'zod'

import type { ErrorMap, ORPCErrorFromErrorMap } from './error'

describe('ORPCErrorFromErrorMap', () => {
  it('converts an error map to an ORPCError union and defaults to unknown when schema is undefined', () => {
    const errorMap = {
      TEST1: { data: z.string() },
      TEST2: { data: z.number().transform(() => 'string') },
      UNDEFINED_SCHEMA: {},
    }

    expectTypeOf<ORPCErrorFromErrorMap<typeof errorMap>>().toEqualTypeOf<
      | ORPCError<'TEST1', string>
      | ORPCError<'TEST2', string>
      | ORPCError<'UNDEFINED_SCHEMA', unknown>
    >()
  })

  it('ignores the `undefined` of optional error codes', () => {
    const flag = true as boolean
    const errorMap = {
      NOT_FOUND: {},
      ...(flag ? { RATE_LIMITED: { data: z.object({ retry: z.number() }) } } : {}),
    }

    expectTypeOf<ORPCErrorFromErrorMap<typeof errorMap>>().toEqualTypeOf<
      ORPCError<'NOT_FOUND', unknown> | ORPCError<'RATE_LIMITED', { retry: number }>
    >()

    expectTypeOf<
      ORPCErrorFromErrorMap<{ OPTIONAL?: { data: z.ZodString } | undefined }>
    >().toEqualTypeOf<ORPCError<'OPTIONAL', string>>()
  })

  it('resolves the generic ErrorMap to ORPCError without undefined', () => {
    expectTypeOf<ORPCErrorFromErrorMap<ErrorMap>>().not.toBeUndefined()
    expectTypeOf<undefined>().not.toExtend<ORPCErrorFromErrorMap<ErrorMap>>()
    expectTypeOf<ORPCErrorFromErrorMap<ErrorMap>>().toExtend<ORPCError<any, unknown>>()
  })
})
