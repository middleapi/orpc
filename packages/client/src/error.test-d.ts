import type { COMMON_ERROR_STATUS_MAP, ORPCErrorCode } from './error'
import { ORPCError } from './error'

describe('ORPCErrorCode', () => {
  it('suggests common codes and accepts any string', () => {
    expectTypeOf<ORPCErrorCode>().toEqualTypeOf<
      keyof typeof COMMON_ERROR_STATUS_MAP | (string & {})
    >()
  })

  it('accepts any string, which oRPC relies on for its own error codes', () => {
    // A custom `Registry['ORPCErrorCode']` must keep `(string & {})`, see docs/error-handling
    expectTypeOf<string>().toExtend<ORPCErrorCode>()
    expectTypeOf<'INTERNAL_SERVER_ERROR'>().toExtend<ORPCErrorCode>()
  })
})

describe('ORPCError', () => {
  it('constructor', () => {
    const _error11: ORPCError<'CODE', undefined | 'optional'> = new ORPCError('CODE')
    const _error12: ORPCError<'CODE', undefined | 'optional'> = new ORPCError('CODE', {
      data: 'optional',
    })
    // @ts-expect-error - data is invalid
    const _error13: ORPCError<'CODE', undefined | 'optional'> = new ORPCError('CODE', {
      data: 'invalid',
    })

    // @ts-expect-error - data is required
    const _error21: ORPCError<'CODE', 'required'> = new ORPCError('CODE')
    const _error22: ORPCError<'CODE', 'required'> = new ORPCError('CODE', { data: 'required' })
    // @ts-expect-error - data is invalid
    const _error23: ORPCError<'CODE', 'required'> = new ORPCError('CODE', { data: 'invalid' })
  })

  it('not allow write .defined property', () => {
    const error = new ORPCError('CODE')
    // @ts-expect-error - not allow write
    error.defined = true as any
  })
})
