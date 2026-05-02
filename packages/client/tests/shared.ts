import type { RouterClient } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { router, streamed } from '../../server/tests/shared'
import { createORPCClient } from '../src'
import { RPCLink } from '../src/adapters/fetch'

const rpcHandler = new RPCHandler(router)

type ClientContext = { cache?: string }

const rpcLink = new RPCLink<ClientContext>({
  url: 'http://localhost:3000',
  fetch: async (url, init, { context }) => {
    if (context?.cache) {
      throw new Error(`cache=${context.cache} is not supported`)
    }

    const request = new Request(url, init)

    const { matched, response } = await rpcHandler.handle(request, {
      context: { db: 'postgres' },
    })

    if (!matched) {
      throw new Error('No procedure matched')
    }

    return response
  },
})

export const orpc: RouterClient<typeof router, ClientContext> = createORPCClient(rpcLink)

const streamedHandler = new RPCHandler({ streamed })

export const streamedOrpc: RouterClient<{ streamed: typeof streamed }, ClientContext> = createORPCClient(new RPCLink({
  url: 'http://localhost:3000',
  fetch: async (url, init) => {
    const { response } = await streamedHandler.handle(new Request(url, init), {
      context: { db: 'postgres' },
    })

    return response ?? new Response('not found', { status: 404 })
  },
}))

enum Test {
  A = 1,
  B = 2,
  C = 'C',
  D = 'D',
}

/**
 * The data types that oRPC guarantees to be supported.
 */
export const supportedDataTypes: { name: string, value: unknown, expected: unknown }[] = [
  {
    name: 'enum',
    value: Test.B,
    expected: Test.B,
  },
  {
    name: 'string',
    value: 'some-string',
    expected: 'some-string',
  },
  {
    name: 'number',
    value: 123,
    expected: 123,
  },
  {
    name: 'NaN',
    value: Number.NaN,
    expected: Number.NaN,
  },
  {
    name: 'true',
    value: true,
    expected: true,
  },
  {
    name: 'false',
    value: false,
    expected: false,
  },
  {
    name: 'null',
    value: null,
    expected: null,
  },
  {
    name: 'undefined',
    value: undefined,
    expected: undefined,
  },
  {
    name: 'date',
    value: new Date('2023-01-01'),
    expected: new Date('2023-01-01'),
  },
  {
    name: 'Invalid Date',
    value: new Date('Invalid'),
    expected: new Date('Invalid'),
  },
  {
    name: 'BigInt',
    value: 99999999999999999999999999999n,
    expected: 99999999999999999999999999999n,
  },
  {
    name: 'regex without flags',
    value: /npa|npb/,
    expected: /npa|npb/,
  },
  {
    name: 'regex with flags',
    value: /uic/gi,
    expected: /uic/gi,
  },
  {
    name: 'URL',
    value: new URL('https://orpc.dev'),
    expected: new URL('https://orpc.dev'),
  },
  {
    name: 'object',
    value: { a: 1, b: 2, c: 3 },
    expected: { a: 1, b: 2, c: 3 },
  },
  {
    name: 'array',
    value: [1, 2, 3],
    expected: [1, 2, 3],
  },
  {
    name: 'map',
    value: new Map([[1, 2], [3, 4]]),
    expected: new Map([[1, 2], [3, 4]]),
  },
  {
    name: 'set',
    value: new Set([1, 2, 3]),
    expected: new Set([1, 2, 3]),
  },
  {
    name: 'blob',
    value: new Blob(['blob'], { type: 'text/plain' }),
    expected: expect.toSatisfy((file: any) => {
      expect(file).toBeInstanceOf(Blob)
      expect(file.type).toBe('text/plain')
      expect(file.size).toBe(4)

      return true
    }),
  },
  {
    name: 'file',
    value: new File(['"name"'], 'file.json', { type: 'application/json' }),
    expected: expect.toSatisfy((file: any) => {
      expect(file).toBeInstanceOf(File)
      expect(file.name).toBe('file.json')
      expect(file.type).toBe('application/json')
      expect(file.size).toBe(6)

      return true
    }),
  },
]
