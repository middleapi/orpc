import { os } from '@orpc/server'
import { OpenAPIHandler } from './openapi-handler'

describe('openAPIHandler', () => {
  it('works', async () => {
    const handler = new OpenAPIHandler(os.route({ method: 'GET', path: '/ping' }).handler(({ input }) => ({ output: input })))

    const { response } = await handler.handle(new Request('https://example.com/api/v1/ping?input=hello'), {
      prefix: '/api/v1',
    })

    await expect(response?.text()).resolves.toContain('hello')
    expect(response?.status).toBe(200)
  })

  it('does not let query or body override path params in compact input', async () => {
    const handler = new OpenAPIHandler({
      get: os.route({ method: 'GET', path: '/posts/{id}' }).handler(({ input }) => input),
      update: os.route({ method: 'POST', path: '/posts/{id}' }).handler(({ input }) => input),
    })

    const { response: getResponse } = await handler.handle(new Request('https://example.com/posts/42?id=99&q=hello'))

    await expect(getResponse?.json()).resolves.toEqual({ id: '42', q: 'hello' })

    const { response: postResponse } = await handler.handle(new Request('https://example.com/posts/24', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '99', title: 'hello' }),
    }))

    await expect(postResponse?.json()).resolves.toEqual({ id: '24', title: 'hello' })
  })
})
