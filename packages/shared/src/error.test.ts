import { AbortError } from '@standard-server/shared'

import { isAbortError, TimeoutError } from './error'

describe('isAbortError', () => {
  it('returns true for AbortError', () => {
    const error = new AbortError('error')
    expect(isAbortError(error)).toBe(true)
  })

  it('returns true when the error name contains Abort', () => {
    const error = new Error('aborted')
    error.name = 'RequestAbortError'

    expect(isAbortError(error)).toBe(true)
  })

  it('returns false for other Error instances', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
  })

  it('returns false when Abort casing differs', () => {
    const error = new Error('aborted')
    error.name = 'aborted'

    expect(isAbortError(error)).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
    expect(isAbortError({ name: 'AbortError' })).toBe(false)
  })

  it('returns false for TimeoutError', () => {
    expect(isAbortError(new TimeoutError('timed out'))).toBe(false)
    expect(isAbortError(new DOMException('timed out', 'TimeoutError'))).toBe(false)
  })

  it('returns true for any Error whose name contains Abort', () => {
    const error = new Error('test')
    error.name = 'NotReallyAnAbortButContainsAbort'

    expect(isAbortError(error)).toBe(true)
  })
})

describe('timeoutError', () => {
  it('uses the same name as AbortSignal.timeout', () => {
    const cause = new Error('cause')
    const error = new TimeoutError('timed out', { cause })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('TimeoutError')
    expect(error.name).toBe(new DOMException('', 'TimeoutError').name)
    expect(error.message).toBe('timed out')
    expect(error.cause).toBe(cause)
  })
})
