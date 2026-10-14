import type { Schema } from '@orpc/contract'
import { os } from '@orpc/server'
import { openapi } from '../../meta'
import { OpenAPIHandler } from './openapi-handler'

const nested = (depth: number) => '['.repeat(depth) + ']'.repeat(depth)

/** Like Valibot: every issue carries the raw, client-controlled input. */
const valibotLike: Schema<{ name: string }> = {
  '~standard': { version: 1, vendor: 'valibot-like', validate: value => ({ issues: [{ message: 'Invalid type', path: ['name'], input: (value as any)?.name } as any] }) },
}

describe('openapiHandler: error responses with deeply nested data', () => {
  const DEPTH = 30_000 // ~60 KB request body, the OpenAPI serializer's frames are smaller
  const handler = new OpenAPIHandler({
    valibotLike: os.meta(openapi({ method: 'POST', path: '/valibot-like' })).input(valibotLike).handler(() => 'ok'),
  })

  it('valibotLike: deeply nested invalid input yields an error response', async () => {
    const result = await handler.handle(new Request('http://localhost/valibot-like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"name":${nested(DEPTH)}}`,
    }))

    expect(result.matched).toBe(true)
    expect(result.response!.status).toBe(400)
    await expect(result.response!.json()).resolves.toEqual({
      defined: false,
      code: 'BAD_REQUEST',
      message: 'Input validation failed',
    })
  })
})
