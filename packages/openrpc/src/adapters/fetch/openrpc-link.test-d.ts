import type { AnyORPCError, ClientContext, ClientLink, ClientOptions, InferClientContext, InferClientError, ORPCError } from '@orpc/client'
import type { StandardLink } from '@orpc/client/standard'
import type { RouterClient } from '@orpc/server'
import type { Promisable } from '@orpc/shared'
import type { StandardHeaders, StandardLazyResponse, StandardUrl } from '@standard-server/core'
import type { OpenRPCClient } from '../../client-types'
import type { JsonRpcErrorObject, JsonRpcParams } from '../../json-rpc'
import type { OpenRPCLinkOptions } from './openrpc-link'
import { createORPCClient } from '@orpc/client'
import { os } from '@orpc/server'
import { z } from 'zod'
import { OpenRPCLink } from './openrpc-link'

const router = {
  ping: os.handler(() => {}),
  planet: {
    find: os
      .input(z.object({ id: z.number() }))
      .errors({ NOT_FOUND: { data: z.object({ at: z.date() }) } })
      .handler(({ input }) => ({ id: input.id, createdAt: new Date(), tags: new Set(['rocky']) })),
    list: os
      .input(z.object({ limit: z.number().optional() }).optional())
      .handler(() => [{ id: 1, distance: 1n }]),
  },
}

describe('OpenRPCLink', () => {
  it('is a StandardLink and a ClientLink', () => {
    const link = new OpenRPCLink()

    expectTypeOf(link).toExtend<StandardLink<ClientContext>>()
    expectTypeOf(link).toExtend<ClientLink<ClientContext>>()
    expectTypeOf(new OpenRPCLink<{ token: string }>()).toExtend<ClientLink<{ token: string }>>()
  })

  it('creates typed clients with OpenRPCClient', async () => {
    const client = createORPCClient<OpenRPCClient<RouterClient<typeof router>>>(new OpenRPCLink({ url: '/rpc' }))

    expectTypeOf(await client.ping()).toEqualTypeOf<null>()

    expectTypeOf(client.planet.find).parameter(0).toEqualTypeOf<{ id: number }>()
    expectTypeOf(await client.planet.find({ id: 1 })).toEqualTypeOf<{ id: number, createdAt: string, tags: string[] }>()

    expectTypeOf(await client.planet.list()).toEqualTypeOf<{ id: number, distance: string }[]>()
    expectTypeOf(client.planet.list).toBeCallableWith({ limit: 1 })

    // @ts-expect-error - input is required
    await client.planet.find()
    // @ts-expect-error - invalid input
    await client.planet.find({ id: '1' })

    expectTypeOf<InferClientError<typeof client.planet.find>>().toEqualTypeOf<Error | ORPCError<'NOT_FOUND', { at: string }>>()
    expectTypeOf<InferClientContext<typeof client.planet.find>>().toEqualTypeOf<object>()
  })

  it('requires matching client context', () => {
    const _withContext: OpenRPCClient<RouterClient<typeof router, { token: string }>> = createORPCClient(new OpenRPCLink<{ token: string }>())
    const _optional: OpenRPCClient<RouterClient<typeof router, { token?: string }>> = createORPCClient(new OpenRPCLink<{ token?: string }>())

    // @ts-expect-error - the link requires a token the client does not provide
    const _missing: OpenRPCClient<RouterClient<typeof router>> = createORPCClient(new OpenRPCLink<{ token: string }>())
  })

  it('types Value callbacks with the client context', () => {
    void new OpenRPCLink<{ token: string, notify?: boolean }>({
      url: (options, path, input) => {
        expectTypeOf(options).toEqualTypeOf<ClientOptions<{ token: string, notify?: boolean }>>()
        expectTypeOf(path).toEqualTypeOf<string[]>()
        expectTypeOf(input).toEqualTypeOf<unknown>()

        return '/rpc'
      },
      headers: async ({ context }) => {
        expectTypeOf(context).toEqualTypeOf<{ token: string, notify?: boolean }>()

        return { authorization: context.token }
      },
      notification: ({ context }) => context.notify ?? false,
      origin: ({ context }) => {
        expectTypeOf(context).toEqualTypeOf<{ token: string, notify?: boolean }>()

        return 'https://api.example.com'
      },
    })
  })

  it('infers the client context from callbacks', () => {
    const link = new OpenRPCLink({
      headers: (options: ClientOptions<{ token: string }>) => ({ authorization: options.context.token }),
    })

    expectTypeOf(link).toEqualTypeOf<OpenRPCLink<{ token: string }>>()
  })

  it('validates option types', () => {
    expectTypeOf<StandardUrl>().toExtend<OpenRPCLinkOptions<ClientContext>['url']>()
    expectTypeOf<(options: ClientOptions<ClientContext>, path: string[], input: unknown) => Promise<StandardUrl>>()
      .toExtend<OpenRPCLinkOptions<ClientContext>['url']>()
    expectTypeOf<StandardHeaders | Headers>().toExtend<OpenRPCLinkOptions<ClientContext>['headers']>()
    expectTypeOf<(options: ClientOptions<ClientContext>, path: string[], input: unknown) => Promisable<StandardHeaders>>()
      .toExtend<OpenRPCLinkOptions<ClientContext>['headers']>()

    void new OpenRPCLink({ url: '/rpc', headers: new Headers(), notification: true })

    // @ts-expect-error - the url must start with "/"
    void new OpenRPCLink({ url: 'rpc' })
    // @ts-expect-error - notification must be a boolean
    void new OpenRPCLink({ notification: 'yes' })
    // @ts-expect-error - errorStatusMap values must be numbers
    void new OpenRPCLink({ errorStatusMap: { NOT_FOUND: '404' } })
  })

  it('types encodeParams', () => {
    void new OpenRPCLink({
      encodeParams: (serializedInput, path) => {
        expectTypeOf(serializedInput).toEqualTypeOf<unknown>()
        expectTypeOf(path).toEqualTypeOf<readonly string[]>()

        return serializedInput as JsonRpcParams
      },
    })

    void new OpenRPCLink({ encodeParams: () => undefined })
    void new OpenRPCLink({ encodeParams: () => [1, 2] })
    void new OpenRPCLink({ encodeParams: () => ({ a: 1 }) })

    // @ts-expect-error - params must be an array or an object
    void new OpenRPCLink({ encodeParams: () => 'x' })
  })

  it('types customErrorDecoder', () => {
    void new OpenRPCLink({
      customErrorDecoder: (error, response) => {
        expectTypeOf(error).toEqualTypeOf<JsonRpcErrorObject>()
        expectTypeOf(response).toEqualTypeOf<StandardLazyResponse>()

        return error.code === 1001 ? {} as AnyORPCError : undefined
      },
    })

    void new OpenRPCLink({ customErrorDecoder: () => null })

    // @ts-expect-error - must return an ORPCError
    void new OpenRPCLink({ customErrorDecoder: () => new Error('x') })
  })
})
