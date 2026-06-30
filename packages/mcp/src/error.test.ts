import { ORPCError } from '@orpc/client'
import { INTERNAL_ERROR, INVALID_PARAMS, RESOURCE_NOT_FOUND } from './constants'
import { JSONRPCError, orpcErrorToJSONRPCError } from './error'

describe('jSONRPCError', () => {
  it('constructs with code, message and stores fields', () => {
    const error = new JSONRPCError(-32601, 'x')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('JSONRPCError')
    expect(error.code).toBe(-32601)
    expect(error.message).toBe('x')
    expect(error.data).toBeUndefined()
  })

  it('toJSON() omits the data key when data is undefined', () => {
    const json = new JSONRPCError(-32601, 'x').toJSON()

    expect(json).toEqual({ code: -32601, message: 'x' })
    expect('data' in json).toBe(false)
  })

  it('toJSON() includes data when provided', () => {
    const json = new JSONRPCError(-32602, 'y', { a: 1 }).toJSON()

    expect(json).toEqual({ code: -32602, message: 'y', data: { a: 1 } })
  })
})

describe('orpcErrorToJSONRPCError', () => {
  it('maps NOT_FOUND to RESOURCE_NOT_FOUND', () => {
    const result = orpcErrorToJSONRPCError(new ORPCError('NOT_FOUND'))

    expect(result).toBeInstanceOf(JSONRPCError)
    expect(result.code).toBe(RESOURCE_NOT_FOUND)
    expect(result.code).toBe(-32002)
  })

  it('maps BAD_REQUEST to INVALID_PARAMS', () => {
    const result = orpcErrorToJSONRPCError(new ORPCError('BAD_REQUEST'))

    expect(result.code).toBe(INVALID_PARAMS)
    expect(result.code).toBe(-32602)
  })

  it('maps INPUT_VALIDATION_FAILED to INVALID_PARAMS', () => {
    const result = orpcErrorToJSONRPCError(new ORPCError('INPUT_VALIDATION_FAILED'))

    expect(result.code).toBe(INVALID_PARAMS)
  })

  it('maps an unknown code to INTERNAL_ERROR', () => {
    const result = orpcErrorToJSONRPCError(new ORPCError('SOMETHING_ELSE'))

    expect(result.code).toBe(INTERNAL_ERROR)
    expect(result.code).toBe(-32603)
  })

  it('returns the same instance when given an existing JSONRPCError', () => {
    const existing = new JSONRPCError(-32700, 'parse error', { detail: true })
    const result = orpcErrorToJSONRPCError(existing)

    expect(result).toBe(existing)
  })

  it('carries the ORPCError message and a data payload of error.toJSON()', () => {
    const error = new ORPCError('CUSTOM_FAILURE', {
      message: 'something went wrong',
      data: { foo: 'bar' },
    })
    const result = orpcErrorToJSONRPCError(error)

    expect(result.code).toBe(INTERNAL_ERROR)
    expect(result.message).toBe('something went wrong')
    expect(result.data).toEqual(error.toJSON())
    expect(result.data).toEqual({
      defined: false,
      inferable: false,
      code: 'CUSTOM_FAILURE',
      message: 'something went wrong',
      data: { foo: 'bar' },
    })
  })

  it('derives the default message from the code when none is given', () => {
    const result = orpcErrorToJSONRPCError(new ORPCError('NOT_FOUND'))

    expect(result.message).toBe('Not Found')
  })
})
