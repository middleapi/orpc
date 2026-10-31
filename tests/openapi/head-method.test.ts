import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { HeadMethodHandlerPlugin } from '@orpc/server/plugins'
import { z } from 'zod'

describe('headMethodHandlerPlugin with OpenAPIHandler', () => {
  const getHandler = vi.fn(({ input }) => ({
    headers: { etag: `"${input.id}"` },
    body: { id: input.id, title: 'Ελλάδα' },
  }))
  const headHandler = vi.fn(() => ({ headers: { 'x-head': '1' } }))

  const router = {
    getTodo: os
      .input(z.object({ id: z.string() }))
      .meta(openapi({
        method: 'GET',
        path: '/todos/{id}',
        outputStructure: 'detailed',
      }))
      .handler(getHandler),
    getUser: os
      .input(z.object({ id: z.string() }))
      .meta(openapi({
        method: 'GET',
        path: '/users/{id}',
      }))
      .handler(({ input }) => input),
    headUser: os
      .input(z.object({ id: z.string() }))
      .meta(openapi({
        method: 'HEAD',
        path: '/users/{id}',
        outputStructure: 'detailed',
      }))
      .handler(headHandler),
    createTodo: os
      .meta(openapi({
        method: 'POST',
        path: '/todos',
      }))
      .handler(() => 'created'),
  }

  const handler = new OpenAPIHandler(router, {
    plugins: [new HeadMethodHandlerPlugin()],
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers HEAD with the headers of the GET route', async () => {
    const { response: getResponse } = await handler.handle(new Request('https://example.com/todos/1'))
    const { matched, response } = await handler.handle(new Request('https://example.com/todos/1', { method: 'HEAD' }))

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    expect(Object.fromEntries(response!.headers)).toEqual({
      ...Object.fromEntries(getResponse!.headers),
      'content-length': (await getResponse!.arrayBuffer()).byteLength.toString(),
    })
    expect(response!.headers.get('etag')).toBe('"1"')
    await expect(response!.text()).resolves.toBe('')
    expect(getHandler).toHaveBeenCalledTimes(2)
    expect(getHandler).toHaveBeenLastCalledWith(expect.any(Object), { id: '1' })
  })

  it('prefers the HEAD route of the same path', async () => {
    const { matched, response } = await handler.handle(new Request('https://example.com/users/1', { method: 'HEAD' }))

    expect(matched).toBe(true)
    expect(response!.headers.get('x-head')).toBe('1')
    await expect(response!.text()).resolves.toBe('')
    expect(headHandler).toHaveBeenCalledOnce()
  })

  it('stays unmatched without a GET route', async () => {
    await expect(handler.handle(new Request('https://example.com/todos', { method: 'HEAD' }))).resolves.toEqual({ matched: false })
  })
})
