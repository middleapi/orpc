import type { AnyRouter } from '@orpc/server'
import type { AddressInfo } from 'node:net'
import * as http from 'node:http'
import { serve } from '@hono/node-server'
import { openapi, OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler as FetchOpenAPIHandler } from '@orpc/openapi/fetch'
import { OpenAPIHandler as NodeOpenAPIHandler } from '@orpc/openapi/node'
import { ORPCError, os } from '@orpc/server'
import { HeadMethodHandlerPlugin } from '@orpc/server/plugins'
import { z } from 'zod'

function createFetchServer(router: AnyRouter, plugins: HeadMethodHandlerPlugin<any>[]) {
  const handler = new FetchOpenAPIHandler(router, { plugins })

  return serve({
    fetch: async (request: Request) => {
      const { response } = await handler.handle(request, { prefix: '/api' })
      return response ?? new Response('Not Found', { status: 404 })
    },
    port: 0,
  })
}

function createNodeServer(router: AnyRouter, plugins: HeadMethodHandlerPlugin<any>[]) {
  const handler = new NodeOpenAPIHandler(router, { plugins })

  return http.createServer(async (req, res) => {
    const { matched } = await handler.handle(req, res, { prefix: '/api' })

    if (!matched) {
      res.statusCode = 404
      res.end('Not Found')
    }
  }).listen(0)
}

describe.each([
  ['fetch', createFetchServer],
  ['node-http', createNodeServer],
] as const)('headMethodHandlerPlugin with %s OpenAPIHandler', (_, createServer) => {
  const getPlanet = vi.fn(({ input }) => {
    if (input.id === 'pluto') {
      throw new ORPCError('NOT_FOUND', { message: 'Pluto is not a planet' })
    }

    return { id: input.id, name: 'Earth', moons: input.moons }
  })
  const headCheck = vi.fn(() => ({ headers: { 'x-planets': '8' } }))
  const listCheck = vi.fn(() => [{ id: 'earth' }])

  const router = {
    planet: {
      get: os
        .meta(openapi({ method: 'GET', path: '/planets/{id}' }))
        .input(z.object({ id: z.string(), moons: z.coerce.number().optional() }))
        .handler(getPlanet),
      check: os
        .meta(openapi({ method: 'HEAD', path: '/planets', outputStructure: 'detailed' }))
        .handler(headCheck),
      list: os
        .meta(openapi({ method: 'GET', path: '/planets' }))
        .handler(listCheck),
      create: os
        .meta(openapi({ method: 'POST', path: '/planets' }))
        .handler(() => ({})),
    },
  }

  const servers: { close: () => unknown }[] = []

  function getOrigin(plugins: HeadMethodHandlerPlugin<any>[] = [new HeadMethodHandlerPlugin()]) {
    const server = createServer(router, plugins)
    servers.push(server)
    return `http://localhost:${(server.address() as AddressInfo).port}`
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    servers.forEach(server => server.close())
  })

  it('answers HEAD with the GET procedure, decoding input from the query', async () => {
    const origin = getOrigin()

    const get = await fetch(`${origin}/api/planets/earth?moons=1`)
    const getBody = await get.text()

    const head = await fetch(`${origin}/api/planets/earth?moons=1`, { method: 'HEAD' })

    expect(getPlanet).toHaveBeenCalledTimes(2)
    expect(getPlanet.mock.calls[1]![0].input).toEqual({ id: 'earth', moons: 1 })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('application/json')
    expect(head.headers.get('content-length')).toBe(`${getBody.length}`)
    expect(head.headers.has('standard-server')).toBe(false)
    await expect(head.text()).resolves.toBe('')
  })

  it('keeps the error status and headers without the body', async () => {
    const origin = getOrigin()

    const get = await fetch(`${origin}/api/planets/pluto`)
    const getBody = await get.text()

    const head = await fetch(`${origin}/api/planets/pluto`, { method: 'HEAD' })

    expect(head.status).toBe(404)
    expect(head.headers.get('content-type')).toBe('application/json')
    expect(head.headers.get('content-length')).toBe(`${getBody.length}`)
    await expect(head.text()).resolves.toBe('')
  })

  it('prefers an explicit HEAD procedure over the GET fallback', async () => {
    const origin = getOrigin()

    const head = await fetch(`${origin}/api/planets`, { method: 'HEAD' })

    expect(headCheck).toHaveBeenCalledOnce()
    expect(listCheck).not.toHaveBeenCalled()
    expect(head.status).toBe(200)
    expect(head.headers.get('x-planets')).toBe('8')
    await expect(head.text()).resolves.toBe('')
  })

  it('does not fall back to other methods', async () => {
    const origin = getOrigin()

    const head = await fetch(`${origin}/api/unknown`, { method: 'HEAD' })

    expect(head.status).toBe(404)
  })

  it('leaves HEAD unmatched without the plugin', async () => {
    const origin = getOrigin([])

    const head = await fetch(`${origin}/api/planets/earth`, { method: 'HEAD' })

    expect(head.status).toBe(404)
    expect(getPlanet).not.toHaveBeenCalled()
  })

  it('does not document HEAD operations for GET procedures', async () => {
    const spec = await new OpenAPIGenerator().generate(router)

    expect(Object.keys(spec.paths!['/planets/{id}']!)).toEqual(['get'])
    expect(Object.keys(spec.paths!['/planets']!)).toEqual(['head', 'get', 'post'])
  })
})
