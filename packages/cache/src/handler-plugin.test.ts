import type { CacheContext } from './types'
import { call, ORPCError, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { MemoryCacheStore } from './adapters/memory'
import {
  CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL,
  CACHE_TAG_HEADER,
  CACHE_TAG_INVALIDATION_HEADER,
  CacheHandlerPlugin,
  decodeCacheTagHeader,
  encodeCacheTagHeader,
} from './handler-plugin'
import { cache, revalidate } from './middleware'

describe('cacheHandlerPlugin', () => {
  const handlerFn = vi.fn()
  const procedure = os.handler(handlerFn)
  const handler = new RPCHandler(procedure, {
    allowMethods: ['GET'], // tests below send GET requests
    plugins: [
      new CacheHandlerPlugin({ headers: [CACHE_TAG_HEADER, CACHE_TAG_INVALIDATION_HEADER] }),
    ],
  })

  afterEach(() => {
    handlerFn.mockReset()
  })

  it('does nothing by default', async () => {
    const defaultHandler = new RPCHandler(procedure, {
      allowMethods: ['GET'],
      plugins: [new CacheHandlerPlugin()],
    })

    handlerFn.mockImplementationOnce(({ context }) => {
      expect(context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL]).toBeUndefined()
    })

    const { response } = await defaultHandler.handle(new Request('http://localhost:3000'))

    expect(handlerFn).toHaveBeenCalledTimes(1)
    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe(null)
    expect(response!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe(null)
  })

  it('reflects cache tags from the first check of the called procedure', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: ['planets', 'planet:1'] },
        { path, procedure, hit: true, stale: false, key: 'k2', tags: ['ignored'] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe('planets,planet:1')
    expect(response!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe(null)
  })

  it('reflects invalidation tags from the first revalidation of the called procedure', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].revalidations.push(
        { path, procedure, tags: ['planets'] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe(null)
    expect(response!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe('planets')
  })

  it('reflects both headers when both kinds of checks ran', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: true, stale: false, key: 'k', tags: ['a'] },
      )
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].revalidations.push(
        { path, procedure, tags: ['b'] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe('a')
    expect(response!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe('b')
  })

  it('ignores checks recorded for other procedures or paths', async () => {
    const other = os.handler(() => 'other')

    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure: other, hit: false, stale: false, key: 'k', tags: ['other-procedure'] },
        { path: [...path, 'nested'], procedure, hit: false, stale: false, key: 'k', tags: ['other-path'] },
      )
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].revalidations.push(
        { path, procedure: other, tags: ['other-procedure'] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe(null)
    expect(response!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe(null)
  })

  it('skips headers when no checks ran or tags are empty', async () => {
    const { response: noChecks } = await handler.handle(new Request('http://localhost:3000'))

    expect(noChecks!.headers.get(CACHE_TAG_HEADER)).toBe(null)
    expect(noChecks!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe(null)

    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: [] },
      )
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].revalidations.push(
        { path, procedure, tags: [] },
      )
    })

    const { response: emptyTags } = await handler.handle(new Request('http://localhost:3000'))

    expect(emptyTags!.headers.get(CACHE_TAG_HEADER)).toBe(null)
    expect(emptyTags!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe(null)
  })

  it('skips headers on error responses', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: ['planets'] },
      )

      throw new ORPCError('INTERNAL_SERVER_ERROR')
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(500)
    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe(null)
  })

  it('percent-encodes tags containing special characters', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: ['a,b', 'tiếng việt'] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    const header = response!.headers.get(CACHE_TAG_HEADER)!
    expect(header).toBe('a%2Cb,ti%E1%BA%BFng%20vi%E1%BB%87t')
    expect(decodeCacheTagHeader(header)).toEqual(['a,b', 'tiếng việt'])
  })

  it('only reflects the tags of the procedure the client called in nested calls', async () => {
    const store = new MemoryCacheStore()

    const inner = os
      .$context<CacheContext>()
      .use(cache({ key: 'inner', tags: ['inner-tag'] }))
      .use(revalidate('inner-revalidated'))
      .handler(() => 'inner')

    const outer = os
      .$context<CacheContext>()
      .use(cache({ key: 'outer', tags: ['outer-tag'] }))
      .use(revalidate('outer-revalidated'))
      .handler(async ({ context }) => `outer:${await call(inner, undefined, { context })}`)

    const nestedHandler = new RPCHandler({ outer, inner }, {
      allowMethods: ['GET'],
      plugins: [new CacheHandlerPlugin({ headers: [CACHE_TAG_HEADER, CACHE_TAG_INVALIDATION_HEADER] })],
    })

    const { response } = await nestedHandler.handle(new Request('http://localhost:3000/outer'), {
      context: { cache: store },
    })

    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe('outer-tag')
    expect(response!.headers.get(CACHE_TAG_INVALIDATION_HEADER)).toBe('outer-revalidated')
  })
})

describe('cacheHandlerPlugin cache-control and cache-tag headers', () => {
  const handlerFn = vi.fn()
  const procedure = os.handler(handlerFn)
  const handler = new RPCHandler(procedure, {
    allowMethods: ['GET', 'POST'],
    plugins: [
      new CacheHandlerPlugin({ headers: ['cache-control', 'cache-tag'] }),
    ],
  })

  afterEach(() => {
    handlerFn.mockReset()
  })

  it('reflects the root cache check into Cache-Tag and Cache-Control on GET responses', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: ['planets', 'a,b'], ttl: 1500, swr: 500 },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get(CACHE_TAG_HEADER)).toBe(null) // only configured headers are set
    expect(response!.headers.get('cache-tag')).toBe('planets,a%2Cb')
    expect(response!.headers.get('cache-control')).toBe('public, s-maxage=2, stale-while-revalidate=1')
  })

  it('holds entries without a ttl for a year, and skips Cache-Tag without tags', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: [] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get('cache-tag')).toBe(null)
    expect(response!.headers.get('cache-control')).toBe('public, s-maxage=31536000')
  })

  it('skips HTTP caching headers on non-GET requests', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].caches.push(
        { path, procedure, hit: false, stale: false, key: 'k', tags: ['planets'], ttl: 1500 },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    }))

    expect(response!.headers.get('cache-tag')).toBe(null)
    expect(response!.headers.get('cache-control')).toBe(null)
  })

  it('skips HTTP caching headers without a root cache check', async () => {
    handlerFn.mockImplementationOnce(({ context, path, procedure }) => {
      context[CACHE_HANDLER_PLUGIN_CONTEXT_SYMBOL].revalidations.push(
        { path, procedure, tags: ['planets'] },
      )
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.headers.get('cache-tag')).toBe(null)
    expect(response!.headers.get('cache-control')).toBe(null)
  })
})

describe('encodeCacheTagHeader & decodeCacheTagHeader', () => {
  it('round-trips tags with commas, percents, and unicode', () => {
    const tags = ['plain', 'a,b', '100%', 'tiếng việt', 'sp ace']

    expect(decodeCacheTagHeader(encodeCacheTagHeader(tags))).toEqual(tags)
  })

  it('decodes empty headers to no tags', () => {
    expect(decodeCacheTagHeader('')).toEqual([])
  })
})
