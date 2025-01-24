import type { baseErrorMap } from '../tests/shared'
import type { ORPCError } from './error-orpc'
import type { ORPCErrorConstructorMap } from './error-utils'
import { isDefinedError } from './error-utils'

it('isDefinedError', () => {
  const orpcError = {} as ORPCError<'CODE', { value: string }> | ORPCError<'BASE', { value: number }>
  const error = {} as Error | typeof orpcError

  if (isDefinedError(error)) {
    expectTypeOf(error).toEqualTypeOf(orpcError)
  }
})

it('ORPCErrorConstructorMap', () => {
  const constructors = {} as ORPCErrorConstructorMap<typeof baseErrorMap>

  const error = constructors.BASE({ data: { output: 123 } })
  expectTypeOf(error).toEqualTypeOf<ORPCError<'BASE', { output: number }>>()

  // @ts-expect-error - invalid data
  constructors.BASE({ data: { output: '123' } })
  // @ts-expect-error - missing data
  constructors.BASE()
  // can call without data if it is optional
  constructors.OVERRIDE()
})
