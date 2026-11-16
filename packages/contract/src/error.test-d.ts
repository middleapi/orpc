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

  it('handles optional and union-valued error codes', () => {
    const flag = true as boolean
    const errorMap = {
      NOT_FOUND: {},
      FAILURE: flag ? { data: z.string() } : { data: z.number() },
      ...(flag ? { RATE_LIMITED: { data: z.object({ retry: z.number() }) } } : {}),
    }

    expectTypeOf<ORPCErrorFromErrorMap<typeof errorMap>>().toEqualTypeOf<
      | ORPCError<'NOT_FOUND', unknown>
      | ORPCError<'FAILURE', string | number>
      | ORPCError<'RATE_LIMITED', { retry: number }>
    >()
  })

  it('resolves the generic ErrorMap to ORPCError without undefined', () => {
    expectTypeOf<ORPCErrorFromErrorMap<ErrorMap>>().toExtend<ORPCError<any, unknown>>()
  })
})
