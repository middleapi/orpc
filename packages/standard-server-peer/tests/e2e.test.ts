import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { StandardRPCJsonSerializer } from '../../client/src/adapters/standard/rpc-json-serializer'
import { StandardRPCSerializer } from '../../client/src/adapters/standard/rpc-serializer'
import { supportedDataTypes } from '../../client/tests/shared'
import { ClientPeer, decodeRequestMessage, ServerPeer } from '../src'

describe('client/server peer', () => {
  let server: ServerPeer

  const client = new ClientPeer(async (raw) => {
    server ??= new ServerPeer(async (raw) => {
      await client.message(typeof raw === 'string' ? Math.random() < 0.5 ? raw : new TextEncoder().encode(raw) : raw)
    })

    const encoded = typeof raw === 'string'
      ? Math.random() < 0.5 ? raw : new TextEncoder().encode(raw) /** increase coverage  */
      : raw
    const decoded = await decodeRequestMessage(encoded)

    server.message(
      decoded,
      async request => ({
        status: 200,
        ...request,
      }),
    )
  })

  const serializer = new StandardRPCSerializer(new StandardRPCJsonSerializer())

  describe.each(supportedDataTypes)('types: %s', ({ value, expected }) => {
    async function assert(value: unknown, expected: unknown): Promise<void> {
      const response = await client.request({
        headers: {},
        method: 'POST',
        signal: undefined,
        url: new URL('http://localhost:3000'),
        body: value instanceof Blob ? value : serializer.serialize(value),
      })

      /**
       * Because RPCSerializer always convert Blob to FormData, we want blob at root for better test coverage.
       */
      const output = await response.body instanceof Blob ? await response.body : serializer.deserialize(response.body)

      expect(output).toEqual(expected)
    }

    it('should work on flat', async () => {
      await assert(value, expected)
    })

    it('should work on nested object', async () => {
      await assert({ data: value }, { data: expected })
    })

    it('should work on complex object', async () => {
      await assert({
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
      })
    })
  })

  it('event iterator', async () => {
    const response = await client.request({
      headers: {},
      method: 'POST',
      signal: undefined,
      url: new URL('http://localhost:3000'),
      body: serializer.serialize((async function* () {
        yield 'hello1'
        yield withEventMeta({ hello2: true }, { id: 'id-1' })
        return withEventMeta({ hello3: true }, { id: 'id-2' })
      })()),
    })

    const output = await serializer.deserialize(response.body) as AsyncGenerator

    expect(await output.next()).toSatisfy(({ done, value }) => {
      expect(done).toBe(false)
      expect(value).toEqual('hello1')
      expect(getEventMeta(value)).toEqual(undefined)

      return true
    })

    expect(await output.next()).toSatisfy(({ done, value }) => {
      expect(done).toBe(false)
      expect(value).toEqual({ hello2: true })
      expect(getEventMeta(value)).toEqual({ id: 'id-1' })

      return true
    })

    expect(await output.next()).toSatisfy(({ done, value }) => {
      expect(done).toBe(true)
      expect(value).toEqual({ hello3: true })
      expect(getEventMeta(value)).toEqual({ id: 'id-2' })

      return true
    })
  })
})
