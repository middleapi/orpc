import type { RouterContractClient } from '@orpc/contract'
import type { AnyRouter } from '@orpc/server'
import { createORPCClient, isDefinedError, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { asyncIteratorObject, oc } from '@orpc/contract'
import { RPCHandler } from '@orpc/server/fetch'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import z from 'zod'
import { createMSWUtils } from './index'

const contract = {
  planet: {
    find: oc
      .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) } })
      .input(z.object({ id: z.number() }))
      .output(z.object({ id: z.number(), name: z.string(), discoveredAt: z.date() })),
    list: oc
      .output(z.array(z.object({ id: z.number(), name: z.string() }))),
    updates: oc
      .input(z.object({ id: z.number() }))
      .output(asyncIteratorObject(z.object({ message: z.string() }))),
  },
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const orpc = createMSWUtils(contract, { url: 'http://localhost:3000/rpc' })

const client: RouterContractClient<typeof contract> = createORPCClient(new RPCLink({
  origin: 'http://localhost:3000',
  url: '/rpc',
}))

describe('handler', () => {
  it('resolves with rpc serialization intact', async () => {
    server.use(orpc.planet.find.handler(({ input }) => ({
      id: input.id,
      name: 'Earth',
      discoveredAt: new Date('2020-01-01'),
    })))

    const planet = await client.planet.find({ id: 42 })

    expect(planet).toEqual({ id: 42, name: 'Earth', discoveredAt: new Date('2020-01-01') })
    expect(planet.discoveredAt).toBeInstanceOf(Date)
  })

  it('provides msw resolver info with a readable request', async () => {
    const fn = vi.fn(({ input }: { input: { id: number } }) => ({
      id: input.id,
      name: 'Earth',
      discoveredAt: new Date('2020-01-01'),
    }))

    server.use(orpc.planet.find.handler(fn))
    await client.planet.find({ id: 1 })

    const options = fn.mock.calls[0]![0] as any
    expect(options.request).toBeInstanceOf(Request)
    expect(options.request.url).toBe('http://localhost:3000/rpc/planet/find')
    expect(options.requestId).toBeTypeOf('string')
    await expect(options.request.json()).resolves.toEqual({ json: { id: 1 } })
  })

  it('validates input like the real rpc handler', async () => {
    server.use(orpc.planet.find.handler(({ input }) => ({
      id: input.id,
      name: 'Earth',
      discoveredAt: new Date('2020-01-01'),
    })))

    await expect(client.planet.find({ id: 'invalid' } as any)).rejects.toSatisfy(
      error => error instanceof ORPCError && error.code === 'BAD_REQUEST',
    )
  })

  it('validates the mocked output', async () => {
    server.use(orpc.planet.find.handler(() => ({ id: 1 }) as any))

    await expect(client.planet.find({ id: 1 })).rejects.toSatisfy(
      error => error instanceof ORPCError && error.code === 'INTERNAL_SERVER_ERROR',
    )
  })

  it('supports throwing typed errors via the errors constructors', async () => {
    server.use(orpc.planet.find.handler(({ input, errors }) => {
      throw errors.NOT_FOUND({ data: { id: input.id } })
    }))

    try {
      await client.planet.find({ id: 7 })
      expect.unreachable()
    }
    catch (error) {
      expect(error).toBeInstanceOf(ORPCError)
      expect(isDefinedError(error)).toBe(true)
      expect((error as any).code).toBe('NOT_FOUND')
      expect((error as any).message).toBe('Planet not found')
      expect((error as any).data).toEqual({ id: 7 })
    }
  })

  it('supports event iterator outputs', async () => {
    server.use(orpc.planet.updates.handler(async function* () {
      yield { message: 'hello' }
      yield { message: 'world' }
    }))

    const messages: string[] = []

    for await (const { message } of await client.planet.updates({ id: 1 })) {
      messages.push(message)
    }

    expect(messages).toEqual(['hello', 'world'])
  })

  it('supports wildcard base urls', async () => {
    const wildcardORPC = createMSWUtils(contract, { url: '*/api/rpc' })

    server.use(wildcardORPC.planet.list.handler(() => [{ id: 1, name: 'Mars' }]))

    const wildcardClient: RouterContractClient<typeof contract> = createORPCClient(new RPCLink({
      origin: 'http://example.com',
      url: '/api/rpc',
    }))

    await expect(wildcardClient.planet.list()).resolves.toEqual([{ id: 1, name: 'Mars' }])
  })

  it('supports overriding the fetch handler, e.g. to configure plugins', async () => {
    const factory = vi.fn((router: AnyRouter) => new RPCHandler(router, {
      fetchInterceptors: [async ({ next }) => {
        const result = await next()

        if (result.matched) {
          result.response.headers.set('x-mocked', '1')
        }

        return result
      }],
    }))

    const customORPC = createMSWUtils(contract, {
      url: 'http://localhost:3000/rpc',
      handler: factory,
    })

    server.use(customORPC.planet.list.handler(() => []))

    const response = await fetch('http://localhost:3000/rpc/planet/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    expect(response.headers.get('x-mocked')).toBe('1')
    await expect(response.json()).resolves.toEqual({ json: [] })

    // the factory receives a router containing only the mocked procedure
    expect(Object.keys(factory.mock.calls[0]![0])).toEqual(['planet'])
  })

  it('leaves unmatched requests to other msw handlers', async () => {
    server.use(
      orpc.planet.list.handler(() => []),
      http.all('http://localhost:3000/*', () => HttpResponse.text('fallback')),
    )

    // GET is not allowed by the rpc handler by default, so it should fall through
    const response = await fetch('http://localhost:3000/rpc/planet/list', { method: 'GET' })

    await expect(response.text()).resolves.toBe('fallback')
  })
})

describe('error', () => {
  it('responds with a defined error like a real server', async () => {
    server.use(orpc.planet.find.error('NOT_FOUND', { data: { id: 42 } }))

    try {
      await client.planet.find({ id: 42 })
      expect.unreachable()
    }
    catch (error) {
      expect(error).toBeInstanceOf(ORPCError)
      expect(isDefinedError(error)).toBe(true)
      expect((error as any).code).toBe('NOT_FOUND')
      expect((error as any).message).toBe('Planet not found')
      expect((error as any).data).toEqual({ id: 42 })
    }
  })

  it('allows overriding the message', async () => {
    server.use(orpc.planet.find.error('NOT_FOUND', { message: 'custom message', data: { id: 1 } }))

    await expect(client.planet.find({ id: 1 })).rejects.toThrow('custom message')
  })
})

describe('loading', () => {
  it('never resolves', async () => {
    server.use(orpc.planet.list.loading())

    const controller = new AbortController()
    const pending = client.planet.list(undefined, { signal: controller.signal })
    pending.catch(() => {}) // silence the abort rejection below

    await expect(Promise.race([
      pending,
      new Promise(resolve => setTimeout(resolve, 100, 'still-loading')),
    ])).resolves.toBe('still-loading')

    controller.abort()
  })
})
