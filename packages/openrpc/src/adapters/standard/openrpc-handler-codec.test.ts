import type { StandardLazyRequest } from '@standard-server/core'
import type { JsonRpcCall, JsonRpcCallRequest } from './call'
import { createORPCErrorFromJson, ORPCError } from '@orpc/client'
import { asyncIteratorObject, oc } from '@orpc/contract'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS, implement, os } from '@orpc/server'
import { z } from 'zod'
import { JSON_RPC_CALL_SYMBOL } from './call'
import { OpenRPCHandlerCodec } from './openrpc-handler-codec'

beforeEach(() => {
  vi.clearAllMocks()
})

function createCallRequest(method: string, params?: unknown, call: Partial<JsonRpcCall> = {}): JsonRpcCallRequest {
  return {
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    resolveBody: vi.fn(async () => params),
    [JSON_RPC_CALL_SYMBOL]: { method, id: 1, notification: false, batch: false, ...call },
  }
}

describe('openRPCHandlerCodec', () => {
  const find = os.input(z.object({ id: z.number() })).handler(({ input }) => input)
  const router = {
    ping: os.handler(() => 'pong'),
    planet: { find },
    a: os.handler(() => 'a'),
  }

  describe('.resolveProcedure', () => {
    it('resolves a marked sub-request by its JSON-RPC method', async () => {
      const codec = new OpenRPCHandlerCodec(router)

      const result = await codec.resolveProcedure(createCallRequest('planet.find'))

      expect(result?.path).toEqual(['planet', 'find'])
      expect(result?.procedure).toBe(find)
    })

    it('never resolves an unmarked request, even when its URL matches a procedure', async () => {
      const codec = new OpenRPCHandlerCodec(router)

      const request: StandardLazyRequest = {
        method: 'POST',
        url: '/planet/find',
        headers: { 'content-type': 'application/json' },
        resolveBody: vi.fn(),
      }

      await expect(codec.resolveProcedure(request)).resolves.toBeUndefined()
      expect(request.resolveBody).not.toHaveBeenCalled()
    })

    it('ignores the sub-request URL', async () => {
      const codec = new OpenRPCHandlerCodec(router)

      const result = await codec.resolveProcedure({ ...createCallRequest('ping'), url: '/planet/find' })

      expect(result?.path).toEqual(['ping'])
    })

    it.each([
      ['rpc.discover'],
      ['rpc.anything'],
      [''],
      ['.a'],
      ['a.'],
      ['a..b'],
      ['planet.find.'],
      ['planet..find'],
    ])('does not resolve reserved or malformed method %j', async (method) => {
      const codec = new OpenRPCHandlerCodec({
        ...router,
        rpc: { discover: os.handler(() => 'user discover'), anything: os.handler(() => 'anything') },
      })

      await expect(codec.resolveProcedure(createCallRequest(method))).resolves.toBeUndefined()
    })

    it('resolves a router key named "rpc" without a dot', async () => {
      const codec = new OpenRPCHandlerCodec({ rpc: os.handler(() => 'rpc') })

      const result = await codec.resolveProcedure(createCallRequest('rpc'))

      expect(result?.path).toEqual(['rpc'])
    })

    it('does not alias percent-encoded or case-changed method names', async () => {
      const codec = new OpenRPCHandlerCodec(router)

      await expect(codec.resolveProcedure(createCallRequest('pl%61net.find'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('planet%2Efind'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('planet/find'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('Planet.Find'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('unknown'))).resolves.toBeUndefined()
    })

    it('resolves router keys that need percent-encoding in a path', async () => {
      const codec = new OpenRPCHandlerCodec({ 'a/b': { 'c d': os.handler(() => 'x') }, 'eth_getBalance': os.handler(() => '0x0') })

      await expect(codec.resolveProcedure(createCallRequest('a/b.c d'))).resolves.toMatchObject({ path: ['a/b', 'c d'] })
      await expect(codec.resolveProcedure(createCallRequest('eth_getBalance'))).resolves.toMatchObject({ path: ['eth_getBalance'] })
    })

    it('excludes procedures with the filter option', async () => {
      const filter = vi.fn((_procedure: unknown, path: readonly string[]) => path[0] !== 'planet')
      const codec = new OpenRPCHandlerCodec(router, { filter })

      await expect(codec.resolveProcedure(createCallRequest('planet.find'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('ping'))).resolves.toMatchObject({ path: ['ping'] })

      expect(filter).toHaveBeenCalledWith(find, ['planet', 'find'])
      expect(filter).toHaveBeenCalledWith(router.ping, ['ping'])
    })

    it('accepts a boolean filter', async () => {
      const codec = new OpenRPCHandlerCodec(router, { filter: false })

      await expect(codec.resolveProcedure(createCallRequest('ping'))).resolves.toBeUndefined()
    })

    it('always excludes event iterator procedures', async () => {
      const filter = vi.fn(() => true)
      const codec = new OpenRPCHandlerCodec({
        output: os.output(asyncIteratorObject(z.string())).handler(async function* () {}),
        input: os.input(asyncIteratorObject(z.string())).handler(() => 'x'),
        ping: router.ping,
      }, { filter })

      await expect(codec.resolveProcedure(createCallRequest('output'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('input'))).resolves.toBeUndefined()
      await expect(codec.resolveProcedure(createCallRequest('ping'))).resolves.toMatchObject({ path: ['ping'] })
    })

    it('resolves procedures in lazy routers', async () => {
      const loader = vi.fn(async () => ({ default: { find } }))
      const codec = new OpenRPCHandlerCodec({ planet: os.lazy(loader) })

      await expect(codec.resolveProcedure(createCallRequest('planet.find'))).resolves.toMatchObject({ path: ['planet', 'find'] })
      await expect(codec.resolveProcedure(createCallRequest('planet.find'))).resolves.toMatchObject({ path: ['planet', 'find'] })
      await expect(codec.resolveProcedure(createCallRequest('planet.missing'))).resolves.toBeUndefined()

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('resolves contract-first routers and applies the filter to contracts', async () => {
      const contract = {
        planet: { find: oc.input(z.object({ id: z.number() })) },
        stream: oc.output(asyncIteratorObject(z.string())),
      }
      const impl = implement(contract)
      const implementedRouter = impl.router({
        planet: { find: impl.planet.find.handler(({ input }) => input) },
        stream: impl.stream.handler(async function* () {}),
      })

      const codec = new OpenRPCHandlerCodec(implementedRouter)

      const result = await codec.resolveProcedure(createCallRequest('planet.find', { id: 1 }))
      expect(result?.path).toEqual(['planet', 'find'])
      await expect(result!.decodeInput()).resolves.toEqual({ id: 1 })

      await expect(codec.resolveProcedure(createCallRequest('stream'))).resolves.toBeUndefined()
    })

    describe('decodeInput', () => {
      it('reads the params from the sub-request body', async () => {
        const codec = new OpenRPCHandlerCodec(router)
        const request = createCallRequest('planet.find', { id: 1 })

        const result = await codec.resolveProcedure(request)

        expect(request.resolveBody).not.toHaveBeenCalled()
        await expect(result!.decodeInput()).resolves.toEqual({ id: 1 })
        expect(request.resolveBody).toHaveBeenCalledTimes(1)
      })

      it('unwraps a single positional param', async () => {
        const codec = new OpenRPCHandlerCodec(router)

        const result = await codec.resolveProcedure(createCallRequest('planet.find', [{ id: 2 }]))

        await expect(result!.decodeInput()).resolves.toEqual({ id: 2 })
      })

      it('normalizes empty params with the input schemas', async () => {
        const codec = new OpenRPCHandlerCodec({
          optional: os.input(z.object({ limit: z.number().optional() })).handler(({ input }) => input),
          void: os.input(z.void()).handler(({ input }) => input),
        })

        const optional = await codec.resolveProcedure(createCallRequest('optional', undefined))
        await expect(optional!.decodeInput()).resolves.toEqual({})

        const voidLike = await codec.resolveProcedure(createCallRequest('void', {}))
        await expect(voidLike!.decodeInput()).resolves.toBeUndefined()
      })

      it('rejects more than one positional param as BAD_REQUEST', async () => {
        const codec = new OpenRPCHandlerCodec(router)

        const result = await codec.resolveProcedure(createCallRequest('planet.find', [1, 2]))

        await expect(result!.decodeInput()).rejects.toThrow(
          new ORPCError('BAD_REQUEST', { message: 'Invalid params: expected at most 1 positional parameter, received 2.' }),
        )
      })
    })
  })

  describe('.encodeOutput', () => {
    const codec = new OpenRPCHandlerCodec(router)

    it('wraps the output in a result member', async () => {
      await expect(codec.encodeOutput({ id: 1 }, find, ['planet', 'find'])).resolves.toEqual({
        status: 200,
        headers: {},
        body: { result: { id: 1 } },
      })
    })

    it('sends undefined as null, so the result member is always present', async () => {
      const response = await codec.encodeOutput(undefined, find, ['planet', 'find'])

      expect(response.body).toEqual({ result: null })
      expect(Object.hasOwn(response.body as object, 'result')).toBe(true)
    })

    it('serializes native types to JSON', async () => {
      const response = await codec.encodeOutput({
        date: new Date('2025-01-01T00:00:00.000Z'),
        invalidDate: new Date('invalid'),
        bigint: 123n,
        set: new Set([1, 2]),
        map: new Map([['a', 1]]),
        nan: Number.NaN,
        url: new URL('https://example.com/a'),
        nested: [undefined, { a: undefined }],
      }, find, ['planet', 'find'])

      expect(response.body).toEqual({
        result: {
          date: '2025-01-01T00:00:00.000Z',
          invalidDate: null,
          bigint: '123',
          set: [1, 2],
          map: [['a', 1]],
          nan: null,
          url: 'https://example.com/a',
          nested: [null, {}],
        },
      })
    })

    it('uses a custom serializer', async () => {
      const serializer = new OpenAPIJsonSerializer()
      const serializeJson = vi.spyOn(serializer, 'serializeJson')
      const custom = new OpenRPCHandlerCodec(router, { serializer })

      await custom.encodeOutput('value', find, ['planet', 'find'])

      expect(serializeJson).toHaveBeenCalledWith('value')
    })

    it('cancels and rejects a ReadableStream output', async () => {
      const cancel = vi.fn()
      const stream = new ReadableStream({ cancel })

      await expect(codec.encodeOutput(stream, find, ['planet', 'find'])).rejects.toThrow(new TypeError(
        '[OpenRPCHandler] Procedure "planet.find" returned a ReadableStream, which JSON-RPC cannot send. Exclude it with the "filter" option.',
      ))
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('closes and rejects an async iterator output', async () => {
      let finished = false
      const iterator = (async function* () {
        try {
          yield 1
        }
        finally {
          finished = true
        }
      })()
      await iterator.next()

      await expect(codec.encodeOutput(iterator, find, ['planet', 'find'])).rejects.toThrow(new TypeError(
        '[OpenRPCHandler] Procedure "planet.find" returned an AsyncIteratorObject, which JSON-RPC cannot send. Exclude it with the "filter" option.',
      ))
      expect(finished).toBe(true)
    })

    it('rejects an output even when its cleanup fails', async () => {
      const stream = new ReadableStream({
        cancel() {
          throw new Error('cleanup failed')
        },
      })

      await expect(codec.encodeOutput(stream, find, ['planet', 'find'])).rejects.toThrow(TypeError)
    })

    it.each([
      ['Blob', new Blob(['x'])],
      ['Blob', new File(['x'], 'a.txt')],
      ['FormData', new FormData()],
      ['URLSearchParams', new URLSearchParams('a=1')],
    ])('rejects a %s output', async (kind, output) => {
      await expect(codec.encodeOutput(output, find, ['planet', 'find'])).rejects.toThrow(new TypeError(
        `[OpenRPCHandler] Procedure "planet.find" returned a ${kind}, which JSON-RPC cannot send. Exclude it with the "filter" option.`,
      ))
    })

    it('rejects an output with nested binary data and names where it is', async () => {
      await expect(codec.encodeOutput({ a: { file: new File(['x'], 'a.txt') }, list: [new Blob(['y'])] }, find, ['planet', 'find'])).rejects.toThrow(new TypeError(
        '[OpenRPCHandler] Procedure "planet.find" returned a Blob at "a.file", "list.0", which JSON-RPC cannot send. Exclude it with the "filter" option.',
      ))
    })

    it('rejects binary data a custom serializer produces at the root', async () => {
      class Attachment {}

      const custom = new OpenRPCHandlerCodec(router, {
        serializer: new OpenAPIJsonSerializer({
          handlers: { attachment: { condition: value => value instanceof Attachment, serialize: () => new Blob(['x']), isTerminal: true } },
        }),
      })

      await expect(custom.encodeOutput(new Attachment(), find, ['planet', 'find'])).rejects.toThrow(
        '[OpenRPCHandler] Procedure "planet.find" returned a Blob at the root, which JSON-RPC cannot send.',
      )
    })

    it.each([
      ['function', () => 1],
      ['symbol', Symbol('result')],
    ])('rejects a result that serializes to a %s, which JSON.stringify would drop', async (kind, output) => {
      await expect(codec.encodeOutput(output, find, ['planet', 'find'])).rejects.toThrow(new TypeError(
        `[OpenRPCHandler] Procedure "planet.find" returned a result that serializes to ${kind}, which JSON-RPC cannot send.`,
      ))
    })

    it('rejects undefined a custom serializer produces at the root', async () => {
      class Missing {}

      const custom = new OpenRPCHandlerCodec(router, {
        serializer: new OpenAPIJsonSerializer({
          handlers: { missing: { condition: value => value instanceof Missing, serialize: () => undefined, isTerminal: true } },
        }),
      })

      await expect(custom.encodeOutput(new Missing(), find, ['planet', 'find'])).rejects.toThrow(
        '[OpenRPCHandler] Procedure "planet.find" returned a result that serializes to undefined, which JSON-RPC cannot send.',
      )
    })

    it('keeps nested functions, which JSON.stringify drops as members', async () => {
      const response = await codec.encodeOutput({ a: 1, fn: () => 1 }, find, ['planet', 'find'])

      expect(JSON.parse(JSON.stringify(response.body))).toEqual({ result: { a: 1 } })
    })
  })

  describe('.encodeError', () => {
    it('encodes an ORPCError as a JSON-RPC error object', () => {
      const codec = new OpenRPCHandlerCodec(router)

      expect(codec.encodeError(new ORPCError('NOT_FOUND'))).toEqual({
        status: 404,
        headers: {},
        body: {
          error: {
            code: -32004,
            message: 'Not Found',
            data: { code: 'NOT_FOUND', defined: false },
          },
        },
      })
    })

    it('keeps the defined flag and serializes the error data', () => {
      const codec = new OpenRPCHandlerCodec(router)
      const error = createORPCErrorFromJson({
        code: 'OUT_OF_STOCK',
        defined: true,
        message: 'Out of stock',
        data: { at: new Date('2025-01-01T00:00:00.000Z'), count: 1n },
      })

      expect(codec.encodeError(error)).toEqual({
        status: DEFAULT_ERROR_STATUS,
        headers: {},
        body: {
          error: {
            code: -32000,
            message: 'Out of stock',
            data: { code: 'OUT_OF_STOCK', defined: true, data: { at: '2025-01-01T00:00:00.000Z', count: '1' } },
          },
        },
      })
    })

    it('maps validation errors to "Invalid params"', () => {
      const codec = new OpenRPCHandlerCodec(router)

      const response = codec.encodeError(new ORPCError('BAD_REQUEST', { message: 'Input validation failed', data: { issues: [] } }))

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: { code: -32602, message: 'Input validation failed', data: { code: 'BAD_REQUEST', defined: false, data: { issues: [] } } },
      })
    })

    it('uses custom error code and status maps, which replace the defaults', () => {
      const codec = new OpenRPCHandlerCodec(router, {
        errorCodeMap: { OUT_OF_STOCK: 1001 },
        errorStatusMap: { OUT_OF_STOCK: 409 },
      })

      expect(codec.encodeError(new ORPCError('OUT_OF_STOCK'))).toMatchObject({
        status: 409,
        body: { error: { code: 1001 } },
      })

      expect(codec.encodeError(new ORPCError('NOT_FOUND'))).toMatchObject({
        status: DEFAULT_ERROR_STATUS,
        body: { error: { code: -32000 } },
      })
    })

    it('only reads own properties of the maps', () => {
      const codec = new OpenRPCHandlerCodec(router)

      expect(codec.encodeError(new ORPCError('toString'))).toMatchObject({
        status: DEFAULT_ERROR_STATUS,
        body: { error: { code: -32000 } },
      })

      expect(codec.encodeError(new ORPCError('__proto__'))).toMatchObject({
        status: DEFAULT_ERROR_STATUS,
        body: { error: { code: -32000 } },
      })
    })

    it('uses the custom error encoder, falling back to the default on null or undefined', () => {
      const customErrorEncoder = vi.fn((error: ORPCError<any, any>) => error.code === 'CUSTOM' ? { code: 7, message: 'custom' } : null)
      const codec = new OpenRPCHandlerCodec(router, { customErrorEncoder })

      expect(codec.encodeError(new ORPCError('CUSTOM'))).toEqual({
        status: DEFAULT_ERROR_STATUS,
        headers: {},
        body: { error: { code: 7, message: 'custom' } },
      })

      expect(codec.encodeError(new ORPCError('NOT_FOUND'))).toMatchObject({
        status: 404,
        body: { error: { code: -32004, message: 'Not Found' } },
      })

      expect(customErrorEncoder).toHaveBeenCalledTimes(2)
    })
  })

  it('rejects error code maps with non-integer values', () => {
    expect(() => new OpenRPCHandlerCodec(router, { errorCodeMap: { A: 1.5 } })).toThrow(
      new TypeError('[OpenRPCHandlerCodec] "errorCodeMap.A" must be an integer JSON-RPC error code, received 1.5.'),
    )

    expect(() => new OpenRPCHandlerCodec(router, { errorCodeMap: { A: Number.NaN } })).toThrow(TypeError)
    expect(() => new OpenRPCHandlerCodec(router, { errorCodeMap: { A: '1' as any } })).toThrow(TypeError)
    expect(() => new OpenRPCHandlerCodec(router, { errorCodeMap: { A: -32000 } })).not.toThrow()
  })
})
