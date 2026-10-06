import type { StandardLinkCodec } from '@orpc/client/standard'
import type { StandardHeaders, StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { CacheLinkPluginContext } from './link-plugin'
import { DedupeLinkPlugin } from '@orpc/client/plugins'
import { StandardLink } from '@orpc/client/standard'
import { encodeCacheTagHeader } from '@orpc/shared'
import { CACHE_LINK_PLUGIN_CONTEXT_SYMBOL, CacheLinkPlugin } from './link-plugin'

const codec: StandardLinkCodec<CacheLinkPluginContext> = {
  encodeInput: async (input, path, { signal }) => ({
    method: 'GET',
    url: `/${path.join('/')}` as `/${string}`,
    headers: {},
    body: input,
    signal,
  } satisfies StandardRequest),
  decodeResponse: async response => ({ kind: 'output', output: await response.resolveBody() }),
}

function createLink(headers: StandardHeaders) {
  const send = vi.fn(async (): Promise<StandardLazyResponse> => ({
    status: 200,
    headers,
    resolveBody: async () => 'output',
  }))

  const link = new StandardLink(codec, { send }, {
    plugins: [
      new DedupeLinkPlugin({ groups: [{ condition: () => true, context: {} }] }),
      new CacheLinkPlugin(),
    ],
  })

  return {
    send,
    call: (context: CacheLinkPluginContext) => link.call(['planet', 'find'], 1, { context }),
  }
}

function createPluginContext() {
  return { tags: [], revalidatedTags: [] }
}

describe('cacheLinkPlugin', () => {
  it('reads the cache tag headers into the plugin context', async () => {
    const { call } = createLink({
      'orpc-cache-tag': encodeCacheTagHeader(['planets', 'planet:Earth', 'a,b']),
      'orpc-cache-tag-invalidation': encodeCacheTagHeader(['users']),
    })

    const pluginContext = createPluginContext()
    await expect(call({ [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: pluginContext })).resolves.toBe('output')

    expect(pluginContext).toEqual({
      tags: ['planets', 'planet:Earth', 'a,b'],
      revalidatedTags: ['users'],
    })
  })

  it('reads missing headers as no tags', async () => {
    const { call } = createLink({})

    const pluginContext = { tags: ['stale'], revalidatedTags: ['stale'] }
    await call({ [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: pluginContext })

    expect(pluginContext).toEqual(createPluginContext())
  })

  it('decodes repeated headers value by value', async () => {
    const { call } = createLink({
      'orpc-cache-tag': [encodeCacheTagHeader(['a', 'b']), encodeCacheTagHeader(['c'])],
    })

    const pluginContext = createPluginContext()
    await call({ [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: pluginContext })

    expect(pluginContext).toEqual({ tags: ['a', 'b', 'c'], revalidatedTags: [] })
  })

  it('does nothing for calls without a plugin context', async () => {
    const { call } = createLink({ 'orpc-cache-tag': 'planets' })

    const context = {}
    await expect(call(context)).resolves.toBe('output')
    expect(context).toEqual({})
  })

  it('leaves the plugin context untouched when the request fails', async () => {
    const { call, send } = createLink({ 'orpc-cache-tag': 'planets' })
    send.mockRejectedValueOnce(new Error('network'))

    const pluginContext = createPluginContext()
    await expect(call({ [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: pluginContext })).rejects.toThrow('network')
    expect(pluginContext).toEqual(createPluginContext())
  })

  it('reads the headers for every caller of a deduplicated request', async () => {
    const { call, send } = createLink({ 'orpc-cache-tag': 'planets' })

    const first = createPluginContext()
    const second = createPluginContext()
    await Promise.all([
      call({ [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: first }),
      call({ [CACHE_LINK_PLUGIN_CONTEXT_SYMBOL]: second }),
    ])

    expect(send).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ tags: ['planets'], revalidatedTags: [] })
    expect(second).toEqual({ tags: ['planets'], revalidatedTags: [] })
  })
})
