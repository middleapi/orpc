import type { COMMON_ERROR_STATUS_MAP, ORPCErrorCode } from './error'
import { ORPCError } from './error'

describe('ORPCErrorCode', () => {
  it('suggests common codes and accepts any string', () => {
    // oRPC relies on any string being a valid code, see docs/error-handling
    expectTypeOf<ORPCErrorCode>().toEqualTypeOf<
      keyof typeof COMMON_ERROR_STATUS_MAP | (string & {})
    >()
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
