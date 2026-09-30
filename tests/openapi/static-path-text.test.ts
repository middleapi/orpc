import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openapi v2 static path text: %s', async (_name, createClientServer) => {
  const router = {
    // Google AIP-136 custom methods
    batchGet: os
      .input(z.any())
      .meta(openapi({ method: 'POST', path: '/v1/files:batchGet' }))
      .handler(({ input }) => ({ procedure: 'batchGet', input })),
    batchCreate: os
      .input(z.any())
      .meta(openapi({ method: 'POST', path: '/v1/files:batchCreate' }))
      .handler(({ input }) => ({ procedure: 'batchCreate', input })),
    find: os
      .input(z.any())
      .meta(openapi({ method: 'GET', path: '/v1/files/{id}' }))
      .handler(({ input }) => ({ procedure: 'find', input })),
    syntax: os
      .input(z.any())
      .meta(openapi({ method: 'GET', path: '/syntax/a*b/(c)/{d}:e' }))
      .handler(({ input }) => ({ procedure: 'syntax', input })),
    cafe: os
      .input(z.any())
      .meta(openapi({ method: 'GET', path: '/café/{name}' }))
      .handler(({ input }) => ({ procedure: 'cafe', input })),
    hello: os
      .input(z.any())
      .meta(openapi({ method: 'POST', path: '/hello world' }))
      .handler(({ input }) => ({ procedure: 'hello', input })),
  }

  const client = createClientServer(router)

  it('routes custom methods that share a prefix to their own procedure', async () => {
    await expect(client.batchGet({ ids: ['1'] })).resolves.toEqual({ procedure: 'batchGet', input: { ids: ['1'] } })
    await expect(client.batchCreate({ files: ['a'] })).resolves.toEqual({ procedure: 'batchCreate', input: { files: ['a'] } })
    await expect(client.find({ id: 'a:b' })).resolves.toEqual({ procedure: 'find', input: { id: 'a:b' } })
  })

  it('routes paths with rou3 syntax as literal text', async () => {
    await expect(client.syntax({ q: '1' })).resolves.toEqual({ procedure: 'syntax', input: { q: '1' } })
  })

  it('routes paths with non-ASCII characters and spaces', async () => {
    await expect(client.cafe({ name: 'crème brûlée' })).resolves.toEqual({ procedure: 'cafe', input: { name: 'crème brûlée' } })
    await expect(client.hello({ a: 1 })).resolves.toEqual({ procedure: 'hello', input: { a: 1 } })
  })
})
