import type { AnyProcedure } from '@orpc/server'
import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { StandardHeaders } from '@standardserver/core'
import type { CacheHandlerPluginContext, CacheHandlerPluginHeader } from './handler-plugin'
import type { CacheContext } from './types'
import { call, ORPCError, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { decodeCacheTagHeader, toArray } from '@orpc/shared'
import { MemoryCacheStore } from './adapters/memory'
import { CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL, CacheHandlerPlugin } from './handler-plugin'
import { cache, revalidate } from './middleware'

type RecordedChecks = Exclude<CacheHandlerPluginContext[typeof CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL], undefined>
type PartialCheck = Partial<RecordedChecks['caches'][number]> & { tags: readonly string[] }

/**
 * Sets response headers from inside the cache plugin's interceptor, standing
 * in for a handler or inner plugin that set its own.
 */
function presetHeadersPlugin(preset: StandardHeaders): StandardHandlerPlugin<any> {
  return {
    name: '~preset-headers',
    init: options => ({
      ...options,
      interceptors: [...toArray(options.interceptors), async (interceptorOptions) => {
        const response = await interceptorOptions.next()
        return { ...response, headers: { ...response.headers, ...preset } }
      }],
    }),
  }
}

function createTestingHandler(headers?: readonly CacheHandlerPluginHeader[], preset?: StandardHeaders) {
  const handlerFn = vi.fn()
  const handler = new RPCHandler(os.handler(handlerFn), {
    allowMethods: ['GET', 'POST'],
    plugins: [
      new CacheHandlerPlugin({ headers: headers ?? [] }),
      // Registered last so its interceptor runs innermost, before the plugin looks.
      ...preset ? [presetHeadersPlugin(preset)] : [],
    ],
  })

  return {
    handlerFn,

    /**
     * Records checks against the called procedure and path, as the
     * middlewares do, then runs `then` inside the same handler call. Each
     * check may override either field to simulate a nested call.
     */
    record(checks: { caches?: PartialCheck[], revalidations?: PartialCheck[] }, then?: () => void) {
      handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
        const recorded: RecordedChecks = context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]
        recorded.caches.push(...toArray(checks.caches).map(check => ({ path, procedure, ...check })))
        recorded.revalidations.push(...toArray(checks.revalidations).map(check => ({ path, procedure, ...check })))
        then?.()
      })
    },

    async handle(init?: RequestInit): Promise<Response> {
      const { response } = await handler.handle(new Request('http://localhost:3000', init))
      return response!
    },
  }
}

const POST = {
  method: 'POST',
  body: JSON.stringify({}),
  headers: { 'content-type': 'application/json' },
} satisfies RequestInit

describe('cacheHandlerPlugin', () => {
  it('does nothing until headers are configured', async () => {
    const { handlerFn, handle } = createTestingHandler()
    handlerFn.mockImplementationOnce(({ context }) => {
      expect(context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]).toBeUndefined()
    })

    const response = await handle()

    expect(handlerFn).toHaveBeenCalledTimes(1)
    expect(response.headers.get('orpc-cache-tag')).toBe(null)
  })

  describe('orpc-cache-tag & orpc-cache-tag-invalidation', () => {
    const headers = ['orpc-cache-tag', 'orpc-cache-tag-invalidation'] as const

    it('reflects the first check of each kind belonging to the called procedure', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({
        caches: [{ tags: ['planets', 'planet:1'] }, { tags: ['ignored'] }],
        revalidations: [{ tags: ['revalidated'] }, { tags: ['ignored'] }],
      })

      const response = await handle()

      expect(response.headers.get('orpc-cache-tag')).toBe('planets,planet:1')
      expect(response.headers.get('orpc-cache-tag-invalidation')).toBe('revalidated')
    })

    it('sets each header only when its own kind of check ran', async () => {
      const cacheOnly = createTestingHandler(headers)
      cacheOnly.record({ caches: [{ tags: ['a'] }] })
      const first = await cacheOnly.handle()

      expect(first.headers.get('orpc-cache-tag')).toBe('a')
      expect(first.headers.get('orpc-cache-tag-invalidation')).toBe(null)

      const revalidationOnly = createTestingHandler(headers)
      revalidationOnly.record({ revalidations: [{ tags: ['b'] }] })
      const second = await revalidationOnly.handle()

      expect(second.headers.get('orpc-cache-tag')).toBe(null)
      expect(second.headers.get('orpc-cache-tag-invalidation')).toBe('b')
    })

    it('ignores checks recorded for other procedures or paths', async () => {
      const other = os.handler(() => 'other')
      const { record, handle } = createTestingHandler(headers)
      record({
        caches: [
          { procedure: other as AnyProcedure, tags: ['other-procedure'] },
          { path: ['nested'], tags: ['other-path'] },
        ],
        revalidations: [{ procedure: other as AnyProcedure, tags: ['other-procedure'] }],
      })

      const response = await handle()

      expect(response.headers.get('orpc-cache-tag')).toBe(null)
      expect(response.headers.get('orpc-cache-tag-invalidation')).toBe(null)
    })

    it('skips headers when no check ran, or its tags are empty', async () => {
      const noChecks = await createTestingHandler(headers).handle()

      expect(noChecks.headers.get('orpc-cache-tag')).toBe(null)
      expect(noChecks.headers.get('orpc-cache-tag-invalidation')).toBe(null)

      const emptyTags = createTestingHandler(headers)
      emptyTags.record({ caches: [{ tags: [] }], revalidations: [{ tags: [] }] })
      const response = await emptyTags.handle()

      expect(response.headers.get('orpc-cache-tag')).toBe(null)
      expect(response.headers.get('orpc-cache-tag-invalidation')).toBe(null)
    })

    it('skips headers on error responses', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({ caches: [{ tags: ['planets'] }] }, () => {
        throw new ORPCError('INTERNAL_SERVER_ERROR')
      })

      const response = await handle()

      expect(response.status).toBe(500)
      expect(response.headers.get('orpc-cache-tag')).toBe(null)
    })

    it('percent-encodes tags containing special characters', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({ caches: [{ tags: ['a,b', 'tiếng việt'] }] })

      const header = (await handle()).headers.get('orpc-cache-tag')!

      expect(header).toBe('a%2Cb,ti%E1%BA%BFng%20vi%E1%BB%87t')
      expect(decodeCacheTagHeader(header)).toEqual(['a,b', 'tiếng việt'])
    })
  })

  describe('cache-control & cache-tag', () => {
    const headers = ['cache-control', 'cache-tag'] as const

    it('reflects the root check, leaving unconfigured headers alone', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({ caches: [{ tags: ['planets', 'a,b'], ttl: 2, swr: 1 }] })

      const response = await handle()

      expect(response.headers.get('orpc-cache-tag')).toBe(null) // only configured headers are set
      expect(response.headers.get('cache-tag')).toBe('planets,a%2Cb')
      expect(response.headers.get('cache-control')).toBe('public, max-age=2, stale-while-revalidate=1')
    })

    it('holds entries without a ttl for a year, and skips Cache-Tag without tags', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({ caches: [{ tags: [] }] })

      const response = await handle()

      expect(response.headers.get('cache-tag')).toBe(null)
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000')
    })

    it('reflects the root check whatever the request method', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({ caches: [{ tags: ['planets'], ttl: 2 }] })

      const response = await handle(POST)

      expect(response.headers.get('cache-tag')).toBe('planets')
      expect(response.headers.get('cache-control')).toBe('public, max-age=2')
    })

    it('skips HTTP caching headers without a root cache check', async () => {
      const { record, handle } = createTestingHandler(headers)
      record({ revalidations: [{ tags: ['planets'] }] })

      const response = await handle()

      expect(response.headers.get('cache-tag')).toBe(null)
      expect(response.headers.get('cache-control')).toBe(null)
    })
  })

  it('only reflects the tags of the procedure the client called in nested calls', async () => {
    const inner = os
      .$context<CacheContext>()
      .use(cache({ key: 'inner', tags: ['inner-tag'] }))
      .use(revalidate({ tags: ['inner-revalidated'] }))
      .handler(() => 'inner')

    const outer = os
      .$context<CacheContext>()
      .use(cache({ key: 'outer', tags: ['outer-tag'] }))
      .use(revalidate({ tags: ['outer-revalidated'] }))
      .handler(async ({ context }) => `outer:${await call(inner, undefined, { context })}`)

    const handler = new RPCHandler({ outer, inner }, {
      allowMethods: ['GET'],
      plugins: [new CacheHandlerPlugin({ headers: ['orpc-cache-tag', 'orpc-cache-tag-invalidation'] })],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/outer'), {
      context: { 'cache/store': new MemoryCacheStore() },
    })

    expect(response!.headers.get('orpc-cache-tag')).toBe('outer-tag')
    expect(response!.headers.get('orpc-cache-tag-invalidation')).toBe('outer-revalidated')
  })
})
