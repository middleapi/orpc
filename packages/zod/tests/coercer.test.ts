import { OpenAPIServerlessHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { z } from 'zod'
import { ZodCoercer } from '../src'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('zodCoercer', () => {
  it('should coerce input', async () => {
    const fn = vi.fn().mockReturnValue('__mocked__')

    const router = os.router({
      ping: os
        .input(z.object({ val: z.bigint() }))
        .handler(fn),
    })

    const handler = new OpenAPIServerlessHandler(router, {
      schemaCoercers: [
        new ZodCoercer(),
      ],
    })
    const res = await handler.fetch(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        val: '123',
      }),
    }))

    expect(res.status).toBe(200)
    expect(fn).toHaveBeenCalledWith({ val: 123n }, undefined, expect.any(Object))
  })
})
