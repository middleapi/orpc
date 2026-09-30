import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { type } from 'arktype'
import * as v from 'valibot'
import * as z from 'zod'

/**
 * Some schema libraries embed the validated value and its parents in their issues,
 * which must not reach the client through the input validation error.
 */
describe('input validation error with detailed input structure', () => {
  const schemas = [
    [
      'valibot',
      v.object({ headers: v.object({ 'x-api-key': v.string() }), body: v.object({ name: v.string() }) }),
    ],
    [
      'arktype',
      type({ headers: { 'x-api-key': 'string' }, body: { name: 'string' } }),
    ],
    [
      'zod',
      z.object({ headers: z.object({ 'x-api-key': z.string() }), body: z.object({ name: z.string() }) }),
    ],
  ] as const

  it.each(schemas)('%s: does not echo request headers', async (_, schema) => {
    const router = {
      create: os
        .meta(openapi({ method: 'POST', path: '/items', inputStructure: 'detailed' }))
        .input(schema)
        .handler(() => 'ok'),
    }

    const { response } = await new OpenAPIHandler(router).handle(new Request('http://localhost/items', {
      method: 'POST',
      body: JSON.stringify({ name: 123 }),
      headers: {
        'content-type': 'application/json',
        'x-origin-verify': 'PROXY_SECRET',
      },
    }))

    expect(response?.status).toBe(400)

    const text = await response!.text()
    expect(text).not.toContain('PROXY_SECRET')

    const json = JSON.parse(text)
    expect(json.code).toBe('BAD_REQUEST')
    expect(json.data.issues).toHaveLength(2)
    expect(json.data.issues).toEqual(expect.arrayContaining([
      { message: expect.any(String), path: ['headers', 'x-api-key'] },
      { message: expect.any(String), path: ['body', 'name'] },
    ]))
  })
})
