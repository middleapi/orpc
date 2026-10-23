import type { RouterClient } from '@orpc/server'
import { ORPCError } from '@orpc/client'
import { oc } from '@orpc/contract'
import { SmartCoercionHandlerPlugin, SmartCoercionLinkPlugin } from '@orpc/json-schema'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { implement, os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { Person } from '../rpc/__shared__/client-server'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openrpc data transfer: %s', async (_name, createClientServer) => {
  const date = new Date('2024-01-02T03:04:05.000Z')
  const customSerializer = new OpenAPIJsonSerializer({
    handlers: {
      person: {
        condition: value => value instanceof Person,
        serialize: value => ({
          __person__: {
            name: value.name,
            age: value.age,
          },
        }),
      },
    },
  })

  const router = {
    echo: os.input(z.any()).handler(({ input }) => input),
    nothing: os.handler(() => undefined),
    whoami: os
      .$context<{ userId: string }>()
      .handler(({ context }) => context.userId),
    error: os.handler(() => {
      throw new ORPCError('NOT_FOUND', {
        message: 'Missing item',
        data: { id: 'missing-item' },
      })
    }),
    definedError: os
      .errors({
        FORBIDDEN: {
          data: z.object({ reason: z.string(), at: z.date() }),
        },
      })
      .handler(({ errors }) => {
        throw errors.FORBIDDEN({
          message: 'Access denied',
          data: { reason: 'no-permission', at: date },
        })
      }),
    customSerializer: os.input(z.any()).handler(({ input }) => ({ client: input, server: new Person('server', 12) })),
  }

  const client = createClientServer(router, {
    context: { userId: 'u_123' },
  })

  const customClient = createClientServer(router, {
    serializer: customSerializer,
  })

  it('supports JSON objects by-name and other values by-position', async () => {
    const value = {
      string: 'héllo 👋 世界',
      number: 1.5,
      boolean: false,
      null: null,
      array: [1, 'two', { three: [3] }],
      nested: { deep: { deeper: 'yes' } },
    }

    await expect(client.echo(value)).resolves.toEqual(value)
    await expect(client.echo([1, 'two', { three: 3 }])).resolves.toEqual([1, 'two', { three: 3 }])
    await expect(client.echo(0)).resolves.toBe(0)
    await expect(client.echo(false)).resolves.toBe(false)
    await expect(client.echo(null)).resolves.toBe(null)
  })

  it('sends Date, BigInt, Set, Map, and URL as JSON', async () => {
    await expect(client.echo({
      date,
      bigint: 12345678901234567890n,
      set: new Set(['a', 'b']),
      map: new Map([['a', 1]]),
      url: new URL('https://orpc.dev/docs'),
      nan: Number.NaN,
    })).resolves.toEqual({
      date: date.toISOString(),
      bigint: '12345678901234567890',
      set: ['a', 'b'],
      map: [['a', 1]],
      url: 'https://orpc.dev/docs',
      nan: null,
    })
  })

  it('receives undefined as null, except object properties which are omitted', async () => {
    await expect(client.nothing()).resolves.toBe(null)
    await expect(client.echo()).resolves.toBe(null)
    await expect(client.echo([undefined])).resolves.toEqual([null])
    await expect(client.echo({ omitted: undefined })).resolves.toEqual({})
  })

  it('passes the initial context to procedures', async () => {
    await expect(client.whoami()).resolves.toBe('u_123')
  })

  it('supports custom serializer', async () => {
    const person = new Person('Alice', 30)

    await expect(customClient.customSerializer(person)).resolves.toEqual({
      client: {
        __person__: {
          age: 30,
          name: 'Alice',
        },
      },
      server: {
        __person__: {
          age: 12,
          name: 'server',
        },
      },
    })
  })

  it('propagates ORPC errors through JSON-RPC errors', async () => {
    await expect(client.error()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Missing item',
      data: { id: 'missing-item' },
      defined: false,
    })
  })

  it('propagates typesafe errors with the defined flag', async () => {
    await expect(client.definedError()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Access denied',
      data: { reason: 'no-permission', at: date.toISOString() },
      defined: true,
    })
  })

  describe('with smart coercion plugins', () => {
    const native = z.object({
      date: z.date(),
      bigint: z.bigint(),
      set: z.set(z.string()),
      map: z.map(z.string(), z.number()),
    })

    const contract = {
      native: oc.input(native).output(native),
      nativeError: oc.errors({ CONFLICT: { data: z.object({ at: z.date() }) } }),
    }

    const implementer = implement(contract)
    const received = vi.fn()

    const nativeRouter = implementer.router({
      native: implementer.native.handler(({ input }) => {
        received(input)
        return input
      }),
      nativeError: implementer.nativeError.handler(({ errors }) => {
        throw errors.CONFLICT({ data: { at: date } })
      }),
    })

    // native types are restored, so the client is not jsonified
    const nativeClient = createClientServer(nativeRouter, {
      handlerPlugins: [new SmartCoercionHandlerPlugin({ converters: [new ZodToJsonSchemaConverter()] })],
      linkPlugins: [new SmartCoercionLinkPlugin(contract, { converters: [new ZodToJsonSchemaConverter()] })],
    }) as unknown as RouterClient<typeof nativeRouter>

    it('restores native types of inputs and outputs', async () => {
      const value = {
        date,
        bigint: 12345678901234567890n,
        set: new Set(['a', 'b']),
        map: new Map([['a', 1], ['b', 2]]),
      }

      await expect(nativeClient.native(value)).resolves.toEqual(value)
      expect(received).toHaveBeenCalledWith(value)
    })

    it('restores native types of defined error data', async () => {
      await expect(nativeClient.nativeError()).rejects.toMatchObject({
        code: 'CONFLICT',
        defined: true,
        data: { at: date },
      })
    })
  })
})
