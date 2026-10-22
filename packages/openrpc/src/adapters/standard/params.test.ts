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

  it('unwraps a single positional param', async () => {
    await expect(decodeJsonRpcParams(['value'], procedure)).resolves.toBe('value')
    await expect(decodeJsonRpcParams([null], procedure)).resolves.toBe(null)
    await expect(decodeJsonRpcParams([[1, 2]], procedure)).resolves.toEqual([1, 2])

    const value = {}
    await expect(decodeJsonRpcParams([value], procedure)).resolves.toBe(value)
  })

  it('passes non-empty by-name params through', async () => {
    const params = { a: 'value' }
    await expect(decodeJsonRpcParams(params, procedure)).resolves.toBe(params)

    const nullPrototype = Object.assign(Object.create(null), { a: 'value' })
    await expect(decodeJsonRpcParams(nullPrototype, procedure)).resolves.toBe(nullPrototype)
  })

  it('rejects more than one positional param as invalid params', async () => {
    await expect(decodeJsonRpcParams([1, 2], procedure)).rejects.toThrow(
      new ORPCError('BAD_REQUEST', { message: 'Invalid params: expected at most 1 positional parameter, received 2.' }),
    )

    const error = await decodeJsonRpcParams([1, 2, 3], procedure).catch(error => error)

    expect(error).toBeInstanceOf(ORPCError)
    expect((error as ORPCError<any, any>).code).toBe('BAD_REQUEST')
    expect((error as ORPCError<any, any>).message).toBe('Invalid params: expected at most 1 positional parameter, received 3.')
  })

  it.each([['string'], [1], [true], [new Date()], [new Map()]])('rejects other params: %s', async (params) => {
    await expect(decodeJsonRpcParams(params, procedure)).rejects.toThrow(
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
      ['z.object({}) with async refine', z.object({}).refine(async () => true), {}, {}],
      ['z.object({ a: optional }) with async refine', z.object({ a: z.string().optional() }).refine(async () => true), {}, {}],
      ['z.object({ a: optional with async refine })', z.object({ a: z.string().optional().refine(async () => true) }), {}, {}],
      ['z.object({ a: required }) with async refine', z.object({ a: z.string() }).refine(async () => true), undefined, {}],
      ['z.void() with async refine', z.void().refine(async () => true), undefined, undefined],
      ['z.object({}).optional() with async refine', z.object({}).optional().refine(async () => true), undefined, {}],
      ['async validation that rejects', customSchema(() => Promise.reject(new Error('async failure'))), undefined, {}],
      ['validation that throws', customSchema(() => {
        throw new Error('sync failure')
      }), undefined, {}],
    ] as const)('normalizes empty params for %s', async (_, schema, absent, object) => {
      for (const procedure of [schema ? oc.input(schema) : oc, schema ? os.input(schema).handler(() => {}) : os.handler(() => {})]) {
        await expect(decodeJsonRpcParams(EMPTY_PARAMS.absent, procedure)).resolves.toEqual(absent)
        await expect(decodeJsonRpcParams(EMPTY_PARAMS.null, procedure)).resolves.toEqual(absent)
        await expect(decodeJsonRpcParams(EMPTY_PARAMS['[]'], procedure)).resolves.toEqual(absent)
        await expect(decodeJsonRpcParams(EMPTY_PARAMS['{}'], procedure)).resolves.toEqual(object)
        await expect(decodeJsonRpcParams(EMPTY_PARAMS['null-prototype {}'], procedure)).resolves.toEqual(object)
      }
    })

    it('combines several input schemas', async () => {
      const procedure = oc.input(z.object({ a: z.string().optional() })).input(z.void())

      // `undefined` passes z.void() but not the object, and `{}` the object but not z.void()
      await expect(decodeJsonRpcParams(undefined, procedure)).resolves.toBe(undefined)
      await expect(decodeJsonRpcParams({}, procedure)).resolves.toEqual({})
    })

    it('combines sync and async input schemas', async () => {
      const procedure = oc.input(z.object({ a: z.string().optional() })).input(z.object({}).refine(async () => true))

      await expect(decodeJsonRpcParams(undefined, procedure)).resolves.toEqual({})
      await expect(decodeJsonRpcParams([], procedure)).resolves.toEqual({})
      await expect(decodeJsonRpcParams({}, procedure)).resolves.toEqual({})
    })

    it('returns a fresh object every time', async () => {
      const procedure = oc.input(z.object({ a: z.string().optional() }))
      const first = await decodeJsonRpcParams(undefined, procedure)

      expect(first).toEqual({})
      await expect(decodeJsonRpcParams(undefined, procedure)).resolves.not.toBe(first)
    })

    it('probes the input schemas once per procedure', async () => {
      const validate = vi.fn((value: unknown) => value === undefined ? { value } : { issues: [{ message: 'expected undefined' }] })
      const procedure = oc.input(customSchema(validate))

      await expect(decodeJsonRpcParams({ a: 1 }, procedure)).resolves.toEqual({ a: 1 })
      await expect(decodeJsonRpcParams(['x'], procedure)).resolves.toBe('x')
      expect(validate).not.toHaveBeenCalled()

      await expect(decodeJsonRpcParams([], procedure)).resolves.toBe(undefined)
      expect(validate).toHaveBeenCalledTimes(2)
      expect(validate).toHaveBeenCalledWith(undefined)
      expect(validate).toHaveBeenCalledWith({})

      await expect(decodeJsonRpcParams({}, procedure)).resolves.toBe(undefined)
      await expect(decodeJsonRpcParams(undefined, procedure)).resolves.toBe(undefined)
      await expect(decodeJsonRpcParams(null, procedure)).resolves.toBe(undefined)
      expect(validate).toHaveBeenCalledTimes(2)

      // another procedure with the same schema gets its own probe
      await expect(decodeJsonRpcParams([], oc.input(customSchema(validate)))).resolves.toBe(undefined)
      expect(validate).toHaveBeenCalledTimes(4)
    })

    it('probes async input schemas once per procedure, even for concurrent calls', async () => {
      const validate = vi.fn(async (value: unknown) => value === undefined ? { issues: [{ message: 'expected an object' }] } : { value })
      const procedure = oc.input(customSchema(validate))

      await expect(Promise.all([
        decodeJsonRpcParams(undefined, procedure),
        decodeJsonRpcParams([], procedure),
        decodeJsonRpcParams(null, procedure),
      ])).resolves.toEqual([{}, {}, {}])

      expect(validate).toHaveBeenCalledTimes(2)
      expect(validate).toHaveBeenCalledWith(undefined)
      expect(validate).toHaveBeenCalledWith({})
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
