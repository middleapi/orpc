import type { AnySchema } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { oc } from '@orpc/contract'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { os } from '@orpc/server'
import { z } from 'zod'
import { decodeJsonRpcParams, encodeJsonRpcParams } from './params'

function customSchema(validate: (value: unknown) => any): AnySchema {
  return { '~standard': { version: 1, vendor: 'custom', validate } }
}

describe('decodeJsonRpcParams', () => {
  const procedure = oc.input(z.object({ a: z.string().optional() }))

  it('unwraps a single positional param', () => {
    expect(decodeJsonRpcParams(['value'], procedure)).toBe('value')
    expect(decodeJsonRpcParams([null], procedure)).toBe(null)
    expect(decodeJsonRpcParams([[1, 2]], procedure)).toEqual([1, 2])

    const value = {}
    expect(decodeJsonRpcParams([value], procedure)).toBe(value)
  })

  it('passes non-empty by-name params through', () => {
    const params = { a: 'value' }
    expect(decodeJsonRpcParams(params, procedure)).toBe(params)

    const nullPrototype = Object.assign(Object.create(null), { a: 'value' })
    expect(decodeJsonRpcParams(nullPrototype, procedure)).toBe(nullPrototype)
  })

  it('rejects more than one positional param as invalid params', () => {
    expect(() => decodeJsonRpcParams([1, 2], procedure)).toThrow(
      new ORPCError('BAD_REQUEST', { message: 'Invalid params: expected at most 1 positional parameter, received 2.' }),
    )

    try {
      decodeJsonRpcParams([1, 2, 3], procedure)
      expect.unreachable()
    }
    catch (error) {
      expect(error).toBeInstanceOf(ORPCError)
      expect((error as ORPCError<any, any>).code).toBe('BAD_REQUEST')
      expect((error as ORPCError<any, any>).message).toBe('Invalid params: expected at most 1 positional parameter, received 3.')
    }
  })

  it.each([['string'], [1], [true], [new Date()], [new Map()]])('rejects other params: %s', (params) => {
    expect(() => decodeJsonRpcParams(params, procedure)).toThrow(
      new ORPCError('BAD_REQUEST', { message: 'Invalid params: expected an array or an object.' }),
    )
  })

  describe('empty params', () => {
    const EMPTY_PARAMS = {
      'absent': undefined,
      'null': null,
      '[]': [],
      '{}': {},
      'null-prototype {}': Object.create(null),
    }

    it.each([
      // [schema, absent/null/[] →, {} →]
      ['no input schema', undefined, undefined, {}],
      ['z.void()', z.void(), undefined, undefined],
      ['z.object({ a: optional })', z.object({ a: z.string().optional() }), {}, {}],
      ['z.object({ a: required })', z.object({ a: z.string() }), undefined, {}],
      ['z.object({ a: required }).optional()', z.object({ a: z.string() }).optional(), undefined, undefined],
      ['z.object({ a: optional }).optional()', z.object({ a: z.string().optional() }).optional(), undefined, {}],
      ['z.string().optional()', z.string().optional(), undefined, undefined],
      ['z.any()', z.any(), undefined, {}],
      ['async refine', z.object({}).refine(async () => true), undefined, {}],
    ] as const)('normalizes empty params for %s', (_, schema, absent, object) => {
      for (const procedure of [schema ? oc.input(schema) : oc, schema ? os.input(schema).handler(() => {}) : os.handler(() => {})]) {
        expect(decodeJsonRpcParams(EMPTY_PARAMS.absent, procedure)).toEqual(absent)
        expect(decodeJsonRpcParams(EMPTY_PARAMS.null, procedure)).toEqual(absent)
        expect(decodeJsonRpcParams(EMPTY_PARAMS['[]'], procedure)).toEqual(absent)
        expect(decodeJsonRpcParams(EMPTY_PARAMS['{}'], procedure)).toEqual(object)
        expect(decodeJsonRpcParams(EMPTY_PARAMS['null-prototype {}'], procedure)).toEqual(object)
      }
    })

    it('combines several input schemas', () => {
      const procedure = oc.input(z.object({ a: z.string().optional() })).input(z.void())

      // `undefined` passes z.void() but not the object, and `{}` the object but not z.void()
      expect(decodeJsonRpcParams(undefined, procedure)).toBe(undefined)
      expect(decodeJsonRpcParams({}, procedure)).toEqual({})
    })

    it('returns a fresh object every time', () => {
      const procedure = oc.input(z.object({ a: z.string().optional() }))
      const first = decodeJsonRpcParams(undefined, procedure)

      expect(first).toEqual({})
      expect(decodeJsonRpcParams(undefined, procedure)).not.toBe(first)
    })

    it('probes the input schemas once per procedure', () => {
      const validate = vi.fn((value: unknown) => value === undefined ? { value } : { issues: [{ message: 'expected undefined' }] })
      const procedure = oc.input(customSchema(validate))

      expect(decodeJsonRpcParams({ a: 1 }, procedure)).toEqual({ a: 1 })
      expect(decodeJsonRpcParams(['x'], procedure)).toBe('x')
      expect(validate).not.toHaveBeenCalled()

      expect(decodeJsonRpcParams([], procedure)).toBe(undefined)
      expect(validate).toHaveBeenCalledTimes(2)
      expect(validate).toHaveBeenCalledWith(undefined)
      expect(validate).toHaveBeenCalledWith({})

      expect(decodeJsonRpcParams({}, procedure)).toBe(undefined)
      expect(decodeJsonRpcParams(undefined, procedure)).toBe(undefined)
      expect(decodeJsonRpcParams(null, procedure)).toBe(undefined)
      expect(validate).toHaveBeenCalledTimes(2)

      // another procedure with the same schema gets its own probe
      expect(decodeJsonRpcParams([], oc.input(customSchema(validate)))).toBe(undefined)
      expect(validate).toHaveBeenCalledTimes(4)
    })
  })
})

describe('encodeJsonRpcParams', () => {
  const serializer = new OpenAPIJsonSerializer()
  const encode = (input: unknown) => encodeJsonRpcParams(input === undefined ? undefined : serializer.serializeJson(input).json)

  it('omits params for undefined input', () => {
    expect(encodeJsonRpcParams(undefined)).toBe(undefined)
    expect(encode(undefined)).toBe(undefined)
  })

  it('sends plain objects by-name', () => {
    const input = { a: 1 }

    expect(encodeJsonRpcParams(input)).toBe(input)
    expect(encode({})).toEqual({})
    expect(encode({ a: new Date('2020-01-01T00:00:00.000Z'), b: undefined })).toEqual({ a: '2020-01-01T00:00:00.000Z' })

    const nullPrototype = Object.assign(Object.create(null), { a: 1 })
    expect(encodeJsonRpcParams(nullPrototype)).toBe(nullPrototype)
  })

  it('sends anything else by-position', () => {
    expect(encode(null)).toEqual([null])
    expect(encode('value')).toEqual(['value'])
    expect(encode(0)).toEqual([0])
    expect(encode(false)).toEqual([false])
    expect(encode([1, 2])).toEqual([[1, 2]])
    expect(encode([])).toEqual([[]])
    expect(encode(new Set([1]))).toEqual([[1]])
    expect(encode(new Map([['a', 1]]))).toEqual([[['a', 1]]])
    expect(encode(new Date('2020-01-01T00:00:00.000Z'))).toEqual(['2020-01-01T00:00:00.000Z'])
    expect(encode(1n)).toEqual(['1'])
  })
})
