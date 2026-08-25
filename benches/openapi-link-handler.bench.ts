import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { StandardLink } from '@orpc/client/standard'
import { oc } from '@orpc/contract'
import { openapi, OpenAPISerializer } from '@orpc/openapi'
import { OpenAPIHandlerCodec, OpenAPILinkCodec } from '@orpc/openapi/standard'
import { os, type } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { bench } from 'vitest'
import { asReadableStream, asSyncIteratorObject, BYTES_10KB, drainBody, EVENTS_10KB, handlers, PAYLOAD_10KB } from './__shared__/payloads'
import '@orpc/openapi/extensions/route'

const serializer = new OpenAPISerializer({ handlers })

const router = {
  ping: os
    .input(type<any>())
    .output(type<any>())
    .handler(({ input }) => input),
}

const handler = new StandardHandler(new OpenAPIHandlerCodec(router, { serializer }), {})

const link = new StandardLink(new OpenAPILinkCodec(router, { serializer }), {
  async send(request, path, options) {
    const { matched, response } = await handler.handle(
      { ...request, resolveBody: () => Promise.resolve(request.body) },
      options,
    )

    if (matched) {
      return { ...response, resolveBody: () => Promise.resolve(response.body) }
    }

    return { status: 404, headers: {}, resolveBody: () => Promise.resolve('Not Found') }
  },
})

const client: RouterClient<typeof router> = createORPCClient(link)

describe('openapi link + handler', () => {
  bench('buffered', async () => {
    await client.ping(PAYLOAD_10KB)
  })

  bench('event stream', async () => {
    await drainBody(
      await client.ping(asSyncIteratorObject(EVENTS_10KB)),
    )
  })

  bench('octet stream', async () => {
    await drainBody(
      await client.ping(asReadableStream(BYTES_10KB)),
    )
  })
})

describe('openapi link codec route resolution depth', () => {
  function buildDeepContract(depth: number) {
    let node: Record<string, any> = { leaf: oc.meta(openapi({})) }

    for (let i = 0; i < depth; i++) {
      node = { [`level${i}`]: node }
    }

    return node
  }

  const codecOptions = { context: {} } as any
  const codecDepth10 = new OpenAPILinkCodec(buildDeepContract(9), {})
  const codecDepth20 = new OpenAPILinkCodec(buildDeepContract(19), {})

  const wideRouter: Record<string, any> = {}
  for (let i = 0; i < 1000; i++) {
    wideRouter[`proc${i}`] = oc.meta(openapi({}))
  }
  const codecWide1000 = new OpenAPILinkCodec(wideRouter, {})

  const pathDepth10 = Array.from({ length: 9 }, (_, i) => `level${i}`).reverse().concat('leaf')
  const pathDepth20 = Array.from({ length: 19 }, (_, i) => `level${i}`).reverse().concat('leaf')

  bench('encodeInput at path depth 10', async () => {
    await codecDepth10.encodeInput(undefined, pathDepth10, codecOptions)
  })

  bench('encodeInput at path depth 20', async () => {
    await codecDepth20.encodeInput(undefined, pathDepth20, codecOptions)
  })

  bench('encodeInput on a 1000-procedure router', async () => {
    await codecWide1000.encodeInput(undefined, ['proc500'], codecOptions)
  })
})

describe('openapi link codec param and query stress', () => {
  const contract = {
    search: oc
      .route({ method: 'GET', path: '/a/{p1}/b/{p2}/c/{p3}/d/{p4}/e/{p5}' })
      .input(type<any>())
      .output(type<any>()),
  }
  const codec = new OpenAPILinkCodec(contract as any, {})
  const options = { context: {} } as any

  const multiParamInput = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, extra: 'x' }

  const queryInput: Record<string, string | number> = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 }
  for (let i = 0; i < 45; i++) {
    queryInput[`q${i}`] = i
  }

  bench('encodeInput with 5 dynamic path params', async () => {
    await codec.encodeInput(multiParamInput, ['search'], options)
  })

  bench('encodeInput GET with 50 query params', async () => {
    await codec.encodeInput(queryInput, ['search'], options)
  })
})
