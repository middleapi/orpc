import type { StandardLazyRequest } from '@standard-server/core'
import { createORPCErrorFromJson, ORPCError } from '@orpc/client'
import { eventIterator } from '@orpc/contract'
import { DEFAULT_ERROR_STATUS, os } from '@orpc/server'
import { z } from 'zod'
import { OpenRPCHandlerCodec } from './openrpc-handler-codec'
import { JSON_RPC_CALL_SYMBOL } from './utils'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openRPCHandlerCodec', () => {
  /**
   * A sub-request the envelope plugin creates for a JSON-RPC call, or a raw HTTP request when `method` is undefined.
   */
  function createRequest(method: string | undefined, params?: unknown, overrides: Partial<StandardLazyRequest> = {}): StandardLazyRequest {
    return {
      method: 'POST',
      url: '/',
      headers: {},
      signal: undefined,
      resolveBody: vi.fn(async () => params),
      ...(method === undefined ? {} : { [JSON_RPC_CALL_SYMBOL]: { method, id: 1 } }),
      ...overrides,
    }
  }

  describe('.resolveProcedure', () => {
    describe('routing', () => {
      const ping = os.handler(vi.fn())
      const find = os.handler(vi.fn())
      const router = {
        ping,
        planet: { find },
        rpc: { discover: os.handler(vi.fn()) },
        events: os.output(eventIterator(z.string())).handler(async function* () {}),
        upload: os.input(eventIterator(z.string())).handler(vi.fn()),
      }

      const codec = new OpenRPCHandlerCodec(router)

      it('resolves the procedure named by the call method, ignoring the request url', async () => {
        const result = await codec.resolveProcedure(createRequest('planet.find', undefined, { url: '/ping' }))

        expect(result).toBeDefined()
        expect(result!.path).toEqual(['planet', 'find'])
        expect(result!.procedure).toBe(find)
      })

      it('never resolves requests that are not marked as a JSON-RPC call', async () => {
        await expect(codec.resolveProcedure(createRequest(undefined, undefined, { url: '/ping' }))).resolves.toBeUndefined()
        await expect(codec.resolveProcedure(createRequest(undefined, undefined, { url: '/planet/find' }))).resolves.toBeUndefined()
      })

      it.each([
        'missing',
        'planet',
        'toString',
        '__proto__',
        'planet/find',
      ])('returns undefined for a method that is not a procedure: %s', async (method) => {
        await expect(codec.resolveProcedure(createRequest(method))).resolves.toBeUndefined()
      })

      it('returns undefined for reserved rpc.* method names, even when the router has them', async () => {
        await expect(codec.resolveProcedure(createRequest('rpc.discover'))).resolves.toBeUndefined()
      })

      it.each([
        '',
        'ping.',
      ])('returns undefined for a method with an empty segment: %j', async (method) => {
        await expect(codec.resolveProcedure(createRequest(method))).resolves.toBeUndefined()
      })

      it('never resolves procedures with an event iterator input or output', async () => {
        await expect(codec.resolveProcedure(createRequest('events'))).resolves.toBeUndefined()
        await expect(codec.resolveProcedure(createRequest('upload'))).resolves.toBeUndefined()
      })

      it('respects the filter option', async () => {
        const filter = vi.fn((_procedure: unknown, path: readonly string[]) => path[0] !== 'ping')
        const codec = new OpenRPCHandlerCodec(router, { filter })

        await expect(codec.resolveProcedure(createRequest('ping'))).resolves.toBeUndefined()
        await expect(codec.resolveProcedure(createRequest('planet.find'))).resolves.toMatchObject({ procedure: find })
        expect(filter).toHaveBeenCalledWith(ping, ['ping'])
      })
    })

    describe('params', () => {
      const router = {
        any: os.handler(vi.fn()),
        object: os.input(z.object({ limit: z.number().optional() })).handler(vi.fn()),
        void: os.input(z.void()).handler(vi.fn()),
        required: os.input(z.object({ id: z.number() })).handler(vi.fn()),
        asyncDefined: os.input(z.any().refine(async input => input !== undefined)).handler(vi.fn()),
        // reads `input.limit` without validating, so it throws for an `undefined` input
        throwing: os.input(z.custom<{ limit?: number }>().transform(input => ({ limit: input.limit ?? 10 }))).handler(vi.fn()),
      }

      const codec = new OpenRPCHandlerCodec(router)

      async function decode(method: keyof typeof router, params: unknown) {
        const result = await codec.resolveProcedure(createRequest(method, params))
        return result!.decodeInput()
      }

      it('reads params only once the input is decoded', async () => {
        const request = createRequest('any', { id: 1 })
        const result = await codec.resolveProcedure(request)

        expect(request.resolveBody).not.toHaveBeenCalled()
        await expect(result!.decodeInput()).resolves.toEqual({ id: 1 })
        expect(request.resolveBody).toHaveBeenCalledOnce()
      })

      it('uses by-name params as the input itself', async () => {
        await expect(decode('required', { id: 1, extra: [true] })).resolves.toEqual({ id: 1, extra: [true] })
      })

      it.each([
        [[42], 42],
        [[[1, 2]], [1, 2]],
        [[{}], {}],
        [[null], null],
      ])('uses the single positional param of %j as the input', async (params, input) => {
        await expect(decode('any', params)).resolves.toEqual(input)
      })

      it('rejects more than one positional param with BAD_REQUEST', async () => {
        const promise = decode('any', [1, 2])

        await expect(promise).rejects.toBeInstanceOf(ORPCError)
        await expect(promise).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: 'Invalid params: expected at most 1 positional parameter, received 2.',
        })
      })

      describe('empty params', () => {
        it.each([undefined, [], {}])('resolves %j to {} when the input schema only accepts an object', async (params) => {
          await expect(decode('object', params)).resolves.toEqual({})
        })

        it.each([undefined, [], {}])('resolves %j to undefined when the input schema only accepts undefined', async (params) => {
          await expect(decode('void', params)).resolves.toBeUndefined()
        })

        it.each([
          [undefined, undefined],
          [[], undefined],
          [{}, {}],
        ])('keeps %j as %j when the input schema accepts both or neither', async (params, input) => {
          await expect(decode('any', params)).resolves.toEqual(input)
          await expect(decode('required', params)).resolves.toEqual(input)
        })

        it('probes async schemas', async () => {
          await expect(decode('asyncDefined', undefined)).resolves.toEqual({})
        })

        it('treats a schema that throws while probing as not accepting the value', async () => {
          await expect(decode('throwing', undefined)).resolves.toEqual({})
        })

        it('probes the input schemas once per procedure', async () => {
          const validate = vi.fn(async (value: unknown) => value === undefined ? { issues: [{ message: 'required' }] } : { value })
          const codec = new OpenRPCHandlerCodec({ probed: os.input({ '~standard': { version: 1, vendor: 'test', validate } }).handler(vi.fn()) })

          for (const params of [undefined, [], {}]) {
            const result = await codec.resolveProcedure(createRequest('probed', params))
            await expect(result!.decodeInput()).resolves.toEqual({})
          }

          expect(validate).toHaveBeenCalledTimes(2)
        })
      })
    })
  })

  describe('.encodeOutput', () => {
    const procedure = os.handler(vi.fn())
    const codec = new OpenRPCHandlerCodec({ procedure })

    it('serializes the output into the result like OpenAPI responses', async () => {
      await expect(codec.encodeOutput({
        date: new Date(0),
        bigint: 1n,
        set: new Set([1, 2]),
        url: new URL('https://example.com'),
        omitted: undefined,
      }, procedure, ['procedure'])).resolves.toEqual({
        status: 200,
        headers: {},
        body: { result: { date: '1970-01-01T00:00:00.000Z', bigint: '1', set: [1, 2], url: 'https://example.com/' } },
      })
    })

    it('sends an undefined output as a null result, keeping the required result member', async () => {
      const response = await codec.encodeOutput(undefined, procedure, ['procedure'])

      expect(response.body).toEqual({ result: null })
      expect(JSON.parse(JSON.stringify(response.body))).toEqual({ result: null })
    })

    it.each([
      ['ReadableStream', (cancel: () => void) => new ReadableStream({ cancel })],
      ['async iterator', (cancel: () => void) => ({ next: vi.fn(), return: cancel, [Symbol.asyncIterator]() { return this } })],
    ])('cancels a %s output and throws, since JSON-RPC cannot stream', async (_, create) => {
      const cancel = vi.fn()

      await expect(codec.encodeOutput(create(cancel), procedure, ['planet', 'stream'])).rejects.toThrow(
        new TypeError('[OpenRPCHandler] Procedure "planet.stream" returned a stream, which JSON-RPC cannot send.'),
      )
      expect(cancel).toHaveBeenCalledOnce()
    })

    it.each([
      ['a blob', { file: new Blob(['x']) }],
      ['a function', () => {}],
      ['a symbol', Symbol('x')],
    ])('throws for an output with %s, which JSON cannot carry', async (_, output) => {
      await expect(codec.encodeOutput(output, procedure, ['procedure'])).rejects.toThrow(
        new TypeError('[OpenRPCHandler] Procedure "procedure" returned a value JSON-RPC cannot send.'),
      )
    })
  })

  describe('.encodeError', () => {
    it('encodes the error with the HTTP status of its code, keeping the oRPC error in data', () => {
      const codec = new OpenRPCHandlerCodec({})

      expect(codec.encodeError(new ORPCError('NOT_FOUND', { message: 'Planet not found', data: { at: new Date(0) } }))).toEqual({
        status: 404,
        headers: {},
        body: {
          error: {
            code: -32004,
            message: 'Planet not found',
            data: { code: 'NOT_FOUND', defined: false, data: { at: '1970-01-01T00:00:00.000Z' } },
          },
        },
      })

      expect(codec.encodeError(createORPCErrorFromJson({ code: 'CONFLICT', defined: true, message: 'Conflict', data: undefined }))).toEqual({
        status: 409,
        headers: {},
        body: { error: { code: -32009, message: 'Conflict', data: { code: 'CONFLICT', defined: true } } },
      })
    })

    it('uses the errorCodeMap option instead of the common map, falling back to -32000', () => {
      const codec = new OpenRPCHandlerCodec({}, { errorCodeMap: { OUT_OF_STOCK: 1001 } })

      expect(codec.encodeError(new ORPCError('OUT_OF_STOCK'))).toMatchObject({ status: DEFAULT_ERROR_STATUS, body: { error: { code: 1001 } } })
      expect(codec.encodeError(new ORPCError('NOT_FOUND'))).toMatchObject({ status: 404, body: { error: { code: -32000 } } })
    })

    it('does not resolve error codes through Object.prototype', () => {
      const codec = new OpenRPCHandlerCodec({})

      expect(codec.encodeError(new ORPCError('toString' as any))).toMatchObject({ status: DEFAULT_ERROR_STATUS, body: { error: { code: -32000 } } })
    })
  })

  it('uses the serializer option for results and error data', async () => {
    const serializer = {
      serializeJson: vi.fn(() => ({ json: '__serialized__', maps: [], blobs: [] })),
      deserializeJson: vi.fn(),
    }

    const procedure = os.handler(vi.fn())
    const codec = new OpenRPCHandlerCodec({ procedure }, { serializer })
    const error = new ORPCError('BAD_REQUEST', { data: '__data__' })

    await expect(codec.encodeOutput('__output__', procedure, ['procedure'])).resolves.toMatchObject({ body: { result: '__serialized__' } })
    expect(codec.encodeError(error)).toMatchObject({ body: { error: { data: '__serialized__' } } })

    expect(serializer.serializeJson).toHaveBeenNthCalledWith(1, '__output__')
    expect(serializer.serializeJson).toHaveBeenNthCalledWith(2, { code: 'BAD_REQUEST', defined: false, data: '__data__' })
  })
})
