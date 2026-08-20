import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { oc } from '@orpc/contract'
import { Lazy, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { setupServer } from 'msw/node'
import z from 'zod'
import { createRouterUtils } from './router-utils'

const contract = {
  ping: oc.input(z.object({ value: z.number() })).output(z.object({ value: z.number() })),
  nested: {
    pong: oc.output(z.string()),
  },
}

it('mirrors the router-contract shape', () => {
  const utils = createRouterUtils(contract, { handler: router => new RPCHandler(router) })

  expect(utils.ping.handler).toBeTypeOf('function')
  expect(utils.ping.error).toBeTypeOf('function')
  expect(utils.ping.loading).toBeTypeOf('function')
  expect(utils.nested.pong.handler).toBeTypeOf('function')
})

it('supports destructuring thanks to bound methods', () => {
  const { loading } = createRouterUtils(contract, { handler: router => new RPCHandler(router) }).nested.pong

  expect(loading()).toBeDefined()
})

it('throws on lazy routers', () => {
  const lazy = new Lazy({ loader: async () => ({ default: {} }), meta: {} })

  expect(() => createRouterUtils({ nested: lazy } as any, { handler: router => new RPCHandler(router) })).toThrow(
    'Lazy routers are not supported at path: "nested". Please convert the router with unlazyRouter',
  )
})

describe('with an implemented router', () => {
  const router = {
    ping: os
      .input(z.object({ value: z.number() }))
      .output(z.object({ value: z.number() }))
      .handler(({ input }) => ({ value: input.value })),
  }

  const server = setupServer()

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  it('mocks procedures instead of calling their real handlers', async () => {
    const utils = createRouterUtils(router, {
      origin: 'http://localhost:3000',
      prefix: '/rpc',
      handler: router => new RPCHandler(router),
    })

    server.use(utils.ping.handler(({ input }) => ({ value: input.value * 2 })))

    const client: RouterClient<typeof router> = createORPCClient(new RPCLink({
      origin: 'http://localhost:3000',
      url: '/rpc',
    }))

    await expect(client.ping({ value: 21 })).resolves.toEqual({ value: 42 })
  })
})
