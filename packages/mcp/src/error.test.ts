import { ORPCError } from '@orpc/client'
import { INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND, RESOURCE_NOT_FOUND } from './constants'
import { toJSONRPCError } from './error'

describe('toJSONRPCError', () => {
  it('maps NOT_FOUND to RESOURCE_NOT_FOUND', () => {
    const result = toJSONRPCError(new ORPCError('NOT_FOUND'))

    expect(result.code).toBe(RESOURCE_NOT_FOUND)
    expect(result.code).toBe(-32002)
  })

  it('maps BAD_REQUEST and INPUT_VALIDATION_FAILED to INVALID_PARAMS', () => {
    expect(toJSONRPCError(new ORPCError('BAD_REQUEST')).code).toBe(INVALID_PARAMS)
    expect(toJSONRPCError(new ORPCError('INPUT_VALIDATION_FAILED')).code).toBe(INVALID_PARAMS)
    expect(INVALID_PARAMS).toBe(-32602)
  })

  it('maps the protocol codes METHOD_NOT_FOUND and INVALID_PARAMS', () => {
    expect(toJSONRPCError(new ORPCError('METHOD_NOT_FOUND')).code).toBe(METHOD_NOT_FOUND)
    expect(toJSONRPCError(new ORPCError('METHOD_NOT_FOUND')).code).toBe(-32601)
    expect(toJSONRPCError(new ORPCError('INVALID_PARAMS')).code).toBe(INVALID_PARAMS)
  })

  it('maps an unknown code to INTERNAL_ERROR', () => {
    const result = toJSONRPCError(new ORPCError('SOMETHING_ELSE'))

    expect(result.code).toBe(INTERNAL_ERROR)
    expect(result.code).toBe(-32603)
  })

  it('normalizes a non-ORPCError to a generic internal error', () => {
    const result = toJSONRPCError(new Error('boom'))

    expect(result.code).toBe(INTERNAL_ERROR)
    // The original message is not leaked; a generic message is used instead.
    expect(result.message).toBe('Internal Server Error')
    expect('data' in result).toBe(false)
  })

  it('omits the data key when the error carries no data', () => {
    const result = toJSONRPCError(new ORPCError('INVALID_PARAMS', { message: 'Invalid cursor' }))

    expect(result).toEqual({ code: INVALID_PARAMS, message: 'Invalid cursor' })
    expect('data' in result).toBe(false)
  })

  it('surfaces the error data when present', () => {
    const result = toJSONRPCError(new ORPCError('CUSTOM_FAILURE', {
      message: 'something went wrong',
      data: { foo: 'bar' },
    }))

    expect(result.code).toBe(INTERNAL_ERROR)
    expect(result.message).toBe('something went wrong')
    expect(result.data).toEqual({ foo: 'bar' })
  })

  it('derives the default message from the code when none is given', () => {
    expect(toJSONRPCError(new ORPCError('NOT_FOUND')).message).toBe('Not Found')
  })
})
