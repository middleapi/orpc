import { runInNewContext } from 'node:vm'
import { AbortError } from '@standard-server/shared'
import { isAbortError, isErrorLike } from './error'

describe('isErrorLike', () => {
  it('returns true for Error instances', () => {
    expect(isErrorLike(new Error('boom'))).toBe(true)
    expect(isErrorLike(new TypeError('boom'))).toBe(true)
  })

  it('returns true for errors from another realm', () => {
    const error = runInNewContext('new TypeError("boom")')

    expect(error instanceof Error).toBe(false)
    expect(isErrorLike(error)).toBe(true)
  })

  it('returns false for non-Error values', () => {
    expect(isErrorLike(null)).toBe(false)
    expect(isErrorLike(undefined)).toBe(false)
    expect(isErrorLike('boom')).toBe(false)
    expect(isErrorLike({ name: 'Error', message: 'boom' })).toBe(false)
  })
})

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

  it('returns true for an AbortError from another realm', () => {
    const error = runInNewContext('const e = new Error("aborted"); e.name = "AbortError"; e')

    expect(error instanceof Error).toBe(false)
    expect(isAbortError(error)).toBe(true)
  })

  it('returns false when the error name is not a string', () => {
    const error = new Error('aborted') as any
    error.name = 123

    expect(isAbortError(error)).toBe(false)
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

  it('returns true for any Error whose name contains Abort', () => {
    const error = new Error('test')
    error.name = 'NotReallyAnAbortButContainsAbort'

    expect(isAbortError(error)).toBe(true)
  })
})
