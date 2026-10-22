import type { ContractRouterClient } from '@orpc/contract'
import { createORPCClient, isDefinedError, safe } from '@orpc/client'
import { oc } from '@orpc/contract'
import { SmartCoercionHandlerPlugin, SmartCoercionLinkPlugin } from '@orpc/json-schema'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { implement, os } from '@orpc/server'
import { JSON_SCHEMA_REGISTRY, ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { Person } from '../rpc/__shared__/client-server'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

const url = z.instanceof(URL)
JSON_SCHEMA_REGISTRY.add(url, { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' })

const native = z.object({
  date: z.date(),
  bigint: z.bigint(),
  set: z.set(z.string()),
  map: z.map(z.string(), z.number()),
  url,
})

/**
 * JSON-RPC carries plain JSON, so restoring native types needs the contract on the client.
 */
const nativeContract = {
  native: oc.input(native).output(native),
  nativeError: oc
    .input(z.object({ at: z.date() }))
    .errors({ CONFLICT: { data: z.object({ at: z.date() }) } }),
}

const nativeImplementer = implement(nativeContract)

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openrpc data transfer: %s', (_name, createClientServer) => {
  const date = new Date('2024-01-02T03:04:05.000Z')

  const router = {
    echo: os.input(z.any()).handler(({ input }) => input),
    nothing: os.handler(() => undefined),
    maybe: os
      .input(z.boolean())
      .output(z.string().optional())
      .handler(({ input }) => input ? 'yes' : undefined),
    person: os.input(z.any()).handler(({ input }) => ({ client: input, server: new Person('server', 12) })),
  }

  const { client, fetchSpy } = createClientServer(router)

  function lastSentBody(spy: typeof fetchSpy = fetchSpy): unknown {
    return JSON.parse(spy.mock.calls.at(-1)![1].body as string)
  }

  it('round trips JSON values', async () => {
    const value = {
      string: 'hello',
      number: 1.5,
      boolean: false,
      null: null,
      array: [1, 'two', { three: [3] }],
      nested: { deep: { deeper: 'yes' } },
    }

    await expect(client.echo(value)).resolves.toEqual(value)
    expect(lastSentBody()).toEqual({ jsonrpc: '2.0', method: 'echo', params: value, id: expect.any(Number) })
  })

  it('sends native types as JSON, the way OpenAPI does', async () => {
    const output = await client.echo({
      date,
      bigint: 12345678901234567890n,
      set: new Set(['a', 'b']),
      map: new Map([['a', 1]]),
      url: new URL('https://orpc.dev/docs'),
      nan: Number.NaN,
      omitted: undefined,
    })

    expect(output).toEqual({
      date: '2024-01-02T03:04:05.000Z',
      bigint: '12345678901234567890',
      set: ['a', 'b'],
      map: [['a', 1]],
      url: 'https://orpc.dev/docs',
      nan: null,
    })
    expect(Object.keys(output)).not.toContain('omitted')
  })

  it('sends non-object inputs by-position and omits params for undefined', async () => {
    await expect(client.echo(null)).resolves.toBe(null)
    expect(lastSentBody()).toMatchObject({ method: 'echo', params: [null] })

    await expect(client.echo([1, 'two', { three: 3 }])).resolves.toEqual([1, 'two', { three: 3 }])
    expect(lastSentBody()).toMatchObject({ params: [[1, 'two', { three: 3 }]] })

    await expect(client.echo('text')).resolves.toBe('text')
    expect(lastSentBody()).toMatchObject({ params: ['text'] })

    await expect(client.echo(0)).resolves.toBe(0)
    expect(lastSentBody()).toMatchObject({ params: [0] })

    await expect(client.echo(false)).resolves.toBe(false)
    expect(lastSentBody()).toMatchObject({ params: [false] })

    await expect(client.echo({})).resolves.toEqual({})
    expect(lastSentBody()).toMatchObject({ params: {} })

    await expect(client.echo()).resolves.toBe(null)
    expect(lastSentBody()).not.toHaveProperty('params')
  })

  it('receives an undefined output as null', async () => {
    const nothing = await client.nothing()
    expectTypeOf(nothing).toEqualTypeOf<null>()
    expect(nothing).toBe(null)

    const yes = await client.maybe(true)
    expectTypeOf(yes).toEqualTypeOf<string | null>()
    expect(yes).toBe('yes')

    await expect(client.maybe(false)).resolves.toBe(null)
  })

  it('rejects binary inputs before sending them', async () => {
    const calls = fetchSpy.mock.calls.length

    await expect(client.echo(new Blob(['hello']))).rejects.toThrow(TypeError)
    await expect(client.echo({ file: new File(['hello'], 'a.txt') })).rejects.toThrow(TypeError)

    expect(fetchSpy).toHaveBeenCalledTimes(calls)
  })

  describe('with a custom serializer', () => {
    const serializer = new OpenAPIJsonSerializer({
      handlers: {
        person: {
          condition: value => value instanceof Person,
          serialize: (value: Person) => ({ __person__: { name: value.name, age: value.age } }),
        },
      },
    })

    const { client } = createClientServer(router, {
      handler: { serializer },
      link: { serializer },
    })

    it('serializes inputs and outputs with it on both sides', async () => {
      await expect(client.person(new Person('Alice', 30))).resolves.toEqual({
        client: { __person__: { name: 'Alice', age: 30 } },
        server: { __person__: { name: 'server', age: 12 } },
      })
    })
  })

  describe('with the smart coercion plugins', () => {
    const received = vi.fn()

    const nativeRouter = nativeImplementer.router({
      native: nativeImplementer.native.handler(({ input }) => {
        received(input)
        return input
      }),
      nativeError: nativeImplementer.nativeError.handler(({ input, errors }) => {
        throw errors.CONFLICT({ data: { at: input.at } })
      }),
    })

    const { link, fetchSpy } = createClientServer(nativeRouter, {
      handler: { plugins: [new SmartCoercionHandlerPlugin({ converters: [new ZodToJsonSchemaConverter()] })] },
      link: { plugins: [new SmartCoercionLinkPlugin(nativeContract, { converters: [new ZodToJsonSchemaConverter()] })] },
    })

    const client = createORPCClient<ContractRouterClient<typeof nativeContract>>(link)

    beforeEach(() => {
      received.mockClear()
    })

    it('restores Date, BigInt, Set, Map, and URL on both sides', async () => {
      const value = {
        date,
        bigint: 12345678901234567890n,
        set: new Set(['a', 'b']),
        map: new Map([['a', 1], ['b', 2]]),
        url: new URL('https://orpc.dev/docs'),
      }

      const output = await client.native(value)

      // the wire carries plain JSON
      expect(lastSentBody(fetchSpy)).toMatchObject({
        params: {
          date: '2024-01-02T03:04:05.000Z',
          bigint: '12345678901234567890',
          set: ['a', 'b'],
          map: [['a', 1], ['b', 2]],
          url: 'https://orpc.dev/docs',
        },
      })

      expect(received).toHaveBeenCalledTimes(1)
      const input = received.mock.calls[0]![0]
      expect(input.date).toBeInstanceOf(Date)
      expect(input.bigint).toBe(12345678901234567890n)
      expect(input.set).toBeInstanceOf(Set)
      expect(input.map).toBeInstanceOf(Map)
      expect(input.url).toBeInstanceOf(URL)
      expect(input).toEqual(value)

      expect(output.date).toBeInstanceOf(Date)
      expect(output.set).toBeInstanceOf(Set)
      expect(output.map).toBeInstanceOf(Map)
      expect(output.url).toBeInstanceOf(URL)
      expect(output).toEqual(value)
    })

    it('restores native types in defined error data', async () => {
      const { error, definedError } = await safe(client.nativeError({ at: date }))

      expect(isDefinedError(error)).toBe(true)
      expect(definedError).toMatchObject({ code: 'CONFLICT', defined: true })
      expect(definedError?.data.at).toBeInstanceOf(Date)
      expect(definedError?.data.at).toEqual(date)
    })
  })
})
