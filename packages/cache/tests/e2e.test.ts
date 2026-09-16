import type { CacheContext } from '../src'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { z } from 'zod'
import { cache, CacheHandlerPlugin, revalidate } from '../src'
import { MemoryCacheStore } from '../src/adapters/memory'

it('works', async () => {
  const findHandlerFn = vi.fn(({ input }) => ({ id: input.id, name: `Planet ${input.id}` }))

  const router = {
    planet: {
      find: os
        .$context<CacheContext>()
        .input(z.object({ id: z.number() }))
        .use(
          cache({
            key: (_, input) => `planet:${input.id}`,
            tags: (_, input) => ['planets', `planet:${input.id}`],
          }),
        )
        .handler(findHandlerFn),
      update: os
        .$context<CacheContext>()
        .input(z.object({ id: z.number(), name: z.string() }))
        .use(
          revalidate({ tags: (_, input) => ['planets', `planet:${input.id}`] }),
        )
        .handler(({ input }) => input),
    },
  }

  const handler = new RPCHandler(router, {
    plugins: [
      new CacheHandlerPlugin({ headers: ['orpc-cache-tag', 'orpc-cache-tag-invalidation'] }),
    ],
  })

  const store = new MemoryCacheStore()

  const request = (path: string, body: unknown) => new Request(`https://example.com/${path}`, {
    method: 'POST',
    body: JSON.stringify({ json: body }),
    headers: {
      'Content-Type': 'application/json',
    },
  })

  const find = () => handler.handle(request('planet/find', { id: 1 }), {
    context: { 'cache/store': store },
  })

  // miss: the handler runs and the response carries the cache tags
  const first = await find()
  expect(first.response?.status).toBe(200)
  expect(first.response?.headers.get('orpc-cache-tag')).toBe('planets,planet:1')
  expect(findHandlerFn).toHaveBeenCalledTimes(1)

  // hit: the handler does not re-run and the response body is identical
  const second = await find()
  expect(second.response?.status).toBe(200)
  expect(second.response?.headers.get('orpc-cache-tag')).toBe('planets,planet:1')
  expect(findHandlerFn).toHaveBeenCalledTimes(1)
  await expect(second.response?.json()).resolves.toEqual(await first.response?.clone().json())

  // update: revalidates the tags and reflects them in the invalidation header
  const update = await handler.handle(request('planet/update', { id: 1, name: 'Mars' }), {
    context: { 'cache/store': store },
  })
  expect(update.response?.status).toBe(200)
  expect(update.response?.headers.get('orpc-cache-tag-invalidation')).toBe('planets,planet:1')

  // miss again: the revalidation evicted the entry
  const third = await find()
  expect(third.response?.status).toBe(200)
  expect(findHandlerFn).toHaveBeenCalledTimes(2)
})
