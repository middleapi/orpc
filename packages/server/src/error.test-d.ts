import type { ORPCError } from '@orpc/client'
import type { ErrorMap } from '@orpc/contract'
import type { ORPCErrorConstructorMap } from './error'
import z from 'zod'

it('ORPCErrorConstructorMap', () => {
  const errorMap = {
    BASE: {
      data: z.object({ output: z.number() }),
    },
    OVERRIDE: {
      data: z.object({ output: z.number() }).optional(),
    },
  } satisfies ErrorMap

  const constructors = {} as ORPCErrorConstructorMap<typeof errorMap>

  const error = constructors.BASE({ data: { output: 123 } })
  expectTypeOf(error).toEqualTypeOf<ORPCError<'BASE', { output: number }>>()

  // @ts-expect-error - invalid data
  constructors.BASE({ data: { output: '123' } })
  // @ts-expect-error - missing data
  constructors.BASE()

  // can call without data if it is optional
  const error2 = constructors.OVERRIDE()
  expectTypeOf(error2).toEqualTypeOf<ORPCError<'OVERRIDE', { output: number } | undefined>>()

  const error3 = constructors.OVERRIDE({ data: { output: 123 } })
  expectTypeOf(error3).toEqualTypeOf<ORPCError<'OVERRIDE', { output: number } | undefined>>()
})
