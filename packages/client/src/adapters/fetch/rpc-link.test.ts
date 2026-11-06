import { getEventMeta, ORPCError, os, withEventMeta } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supportedDataTypes } from '../../../tests/shared'
import { RPCLink } from './rpc-link'

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(supportedDataTypes)('rpcLink: $name', ({ value, expected }) => {
  describe.each(['GET', 'POST'] as const)('method: %s', (method) => {
    async function assertSuccessCase(value: unknown, expected: unknown): Promise<true> {
      const handler = vi.fn(({ input }) => input)

      const rpcHandler = new RPCHandler(os.handler(handler), {
        strictGetMethodPluginEnabled: false,
      })

      const rpcLink = new RPCLink({
        url: 'http://api.example.com',
        method,
        fetch: async (request) => {
          const { matched, response } = await rpcHandler.handle(request)

          if (matched) {
            return response
          }

          throw new Error('No procedure match')
        },
      })

      const output = await rpcLink.call([], value, { context: {} })

      expect(output).toEqual(expected)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ input: expected }))

      return true
    }

    async function assertErrorCase(value: unknown, expected: unknown): Promise<true> {
      const handler = vi.fn(({ input }) => {
        throw new ORPCError('TEST', {
          data: input,
        })
      })

      const rpcHandler = new RPCHandler(os.handler(handler), {
        strictGetMethodPluginEnabled: false,
      })

      const rpcLink = new RPCLink({
        url: 'http://api.example.com',
        method,
        fetch: async (request) => {
          const { matched, response } = await rpcHandler.handle(request)

          if (matched) {
            return response
          }

          throw new Error('No procedure match')
        },
      })

      await expect(rpcLink.call([], value, { context: {} })).rejects.toSatisfy((e) => {
        expect(e).toBeInstanceOf(ORPCError)
        expect(e.code).toBe('TEST')
        expect(e.data).toEqual(expected)

        return true
      })

      return true
    }

    it('should work on flat', async () => {
      expect(await assertSuccessCase(value, expected)).toBe(true)
      expect(await assertErrorCase(value, expected)).toBe(true)
    })

    it('should work on nested object', async () => {
      expect(await assertSuccessCase({ data: value }, { data: expected })).toBe(true)
      expect(await assertErrorCase({ data: value }, { data: expected })).toBe(true)
    })

    it('should work on complex object', async () => {
      expect(await assertSuccessCase({
        '!@#$%^^&()[]>?<~_<:"~+!_': value,
        'list': [value],
        'map': new Map([[value, value]]),
        'set': new Set([value]),
        'nested': {
          nested: value,
        },
      }, {
        '!@#$%^^&()[]>?<~_<:"~+!_': expected,
        'list': [expected],
        'map': new Map([[expected, expected]]),
        'set': new Set([expected]),
        'nested': {
          nested: expected,
        },
      })).toBe(true)

      expect(await assertErrorCase({
        '!@#$%^^&()[]>?<~_<:"~+!_': value,
        'list': [value],
        'map': new Map([[value, value]]),
        'set': new Set([value]),
        'nested': {
          nested: value,
        },
      }, {
        '!@#$%^^&()[]>?<~_<:"~+!_': expected,
        'list': [expected],
        'map': new Map([[expected, expected]]),
        'set': new Set([expected]),
        'nested': {
          nested: expected,
        },
      })).toBe(true)
    })
  })
})

describe('standardRPCLink: event-iterator', async () => {
  const OriginalRequest = globalThis.Request

  beforeEach(() => {
    (globalThis as any).Request = class Request extends OriginalRequest {
      constructor(input: any, init: any) {
        super(input, {
          ...init,
          duplex: 'half',
        } as any)
      }
    }
  })

  afterEach(() => {
    globalThis.Request = OriginalRequest
  })

  const handler = vi.fn(({ input }) => input)

  const rpcHandler = new RPCHandler(os.handler(handler), {
    strictGetMethodPluginEnabled: false,
  })

  const rpcLink = new RPCLink({
    url: 'http://api.example.com',
    fetch: async (request) => {
      const { matched, response } = await rpcHandler.handle(new Request(request))

      if (matched) {
        return response
      }

      throw new Error('No procedure match')
    },
  })

  it('on success', async () => {
    const output = await rpcLink.call([], (async function* () {
      yield 1
      yield withEventMeta({ hello: 2 }, { id: '29224', retry: 8393 })
      return withEventMeta({ hello: 3 }, { id: '391', retry: 28973 })
    })(), { context: {} }) as any

    expect(await output.next()).toEqual({ value: 1, done: false })

    expect(await output.next()).toSatisfy(({ value, done }) => {
      expect(done).toBe(false)
      expect(value).toEqual({ hello: 2 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: '29224', retry: 8393 }))

      return true
    })

    expect(await output.next()).toSatisfy(({ value, done }) => {
      expect(done).toBe(true)
      expect(value).toEqual({ hello: 3 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: '391', retry: 28973 }))

      return true
    })

    expect(await output.next()).toEqual(expect.objectContaining({ value: undefined, done: true }))
  })

  it('on error', async () => {
    const output = await rpcLink.call([], (async function* () {
      yield 1
      yield withEventMeta({ hello: 2 }, { id: '29224', retry: 8393 })
      throw withEventMeta(new ORPCError('INTERNAL', {
        data: { hello: 3 },
      }), { id: '391', retry: 28973 })
    })(), { context: {} }) as any

    expect(await output.next()).toEqual({ value: 1, done: false })

    expect(await output.next()).toSatisfy(({ value, done }) => {
      expect(done).toBe(false)
      expect(value).toEqual({ hello: 2 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: '29224', retry: 8393 }))

      return true
    })

    await expect(output.next()).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ORPCError)
      expect(err.code).toBe('INTERNAL')
      expect(err.data).toEqual({ hello: 3 })
      expect(getEventMeta(err)).toEqual(expect.objectContaining({ id: '391', retry: 28973 }))

      return true
    })

    expect(await output.next()).toEqual(expect.objectContaining({ value: undefined, done: true }))
  })
})

describe('rpcLink: redirect response', () => {
  it.each([
    ['empty body', null],
    ['html body', '<html>Login</html>'],
  ])('rejects a 302 with %s instead of resolving it as output', async (_, body) => {
    const rpcLink = new RPCLink({
      url: 'http://api.example.com',
      fetch: async () => new Response(body, {
        status: 302,
        headers: { 'location': 'http://api.example.com/login', 'content-type': 'text/html' },
      }),
    })

    await expect(rpcLink.call(['ping'], undefined, { context: {} })).rejects.toThrow(
      'Unexpected redirect response (status 302): RPCLink does not follow redirects.',
    )
  })
})
