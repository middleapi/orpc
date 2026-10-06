import type { AnyMetaPlugin } from './meta'
import { oc } from './builder'
import { defineMeta, getReplayableMetaPlugins, resolveMetaPlugins } from './meta-utils'

it('resolveMetaPlugins', () => {
  const baseMeta = { mode: 'base' }

  const plugin1 = {
    name: 'plugin1',
    init: vi.fn(m => ({ ...m, p1: true })),
    apply: vi.fn(m => ({ ...m, a1: true })),
  } satisfies AnyMetaPlugin
  const plugin2 = {
    name: 'plugin2',
    init: vi.fn(m => ({ ...m, p2: true })),
    apply: vi.fn(m => ({ ...m, a2: true })),
  } satisfies AnyMetaPlugin
  const plugin3 = {
    name: 'plugin3',
    init: vi.fn(m => ({ ...m, p3: true })),
    apply: vi.fn(m => ({ ...m, a3: true })),
  } satisfies AnyMetaPlugin
  const plugin4 = {
    name: 'plugin4',
  } satisfies AnyMetaPlugin

  const [meta, plugins] = resolveMetaPlugins(baseMeta, [plugin1], [plugin2, plugin3, plugin4])

  expect(meta).not.toBe(baseMeta)
  expect(meta).toEqual({
    mode: 'base',
    a1: true,
    a2: true,
    a3: true,
    p2: true,
    p3: true,
  })
  expect(plugins).toEqual([plugin1, plugin2, plugin3, plugin4])

  expect(plugin1.init).not.toHaveBeenCalled() // already initialized
  expect(plugin2.init).toHaveBeenCalledTimes(1)
  expect(plugin2.init).toHaveBeenCalledWith({ mode: 'base' })

  expect(plugin3.init).toHaveBeenCalledTimes(1)
  expect(plugin3.init).toHaveBeenCalledWith({ mode: 'base', p2: true })

  expect(plugin1.apply).toHaveBeenCalledTimes(1)
  expect(plugin1.apply).toHaveBeenCalledWith({ mode: 'base', p2: true, p3: true })

  expect(plugin2.apply).toHaveBeenCalledTimes(1)
  expect(plugin2.apply).toHaveBeenCalledWith({ mode: 'base', a1: true, p2: true, p3: true })

  expect(plugin3.apply).toHaveBeenCalledTimes(1)
  expect(plugin3.apply).toHaveBeenCalledWith({ mode: 'base', a1: true, a2: true, p2: true, p3: true })

  expect(plugin2.init).toHaveBeenCalledBefore(plugin3.init)
  expect(plugin1.apply).toHaveBeenCalledBefore(plugin2.apply)
  expect(plugin2.apply).toHaveBeenCalledBefore(plugin3.apply)
})

describe('getReplayableMetaPlugins', () => {
  it('returns existing meta plugins as-is', () => {
    const plugin = { name: 'plugin', init: vi.fn() } satisfies AnyMetaPlugin

    expect(getReplayableMetaPlugins({ '~orpc': { meta: {}, metaPlugins: [plugin] } })).toEqual([plugin])
    expect(getReplayableMetaPlugins({ '~orpc': { meta: { other: true }, metaPlugins: [plugin] } })).toEqual([plugin])
  })

  it('returns no plugins when there is nothing to replay', () => {
    expect(getReplayableMetaPlugins({ '~orpc': { meta: {} } })).toEqual([])
    expect(getReplayableMetaPlugins({ '~orpc': { meta: {}, metaPlugins: [] } })).toEqual([])
  })

  it('wraps meta that was not built from plugins into a plugin', () => {
    const symbol = Symbol('symbol')
    const meta = { 'own': true, 'shared': 'own', '~nested': { value: 1 }, [symbol]: 'symbol' }

    const plugins = getReplayableMetaPlugins({ '~orpc': { meta } })
    const [resolved] = resolveMetaPlugins({ base: true, shared: 'base' }, undefined, plugins)

    expect(plugins).toHaveLength(1)
    expect(resolved).toEqual({ 'base': true, 'own': true, 'shared': 'own', '~nested': { value: 1 }, [symbol]: 'symbol' })
    expect(getReplayableMetaPlugins({ '~orpc': { meta: { [symbol]: 'symbol' }, metaPlugins: [] } })).toHaveLength(1)
  })
})

it('defineMeta', () => {
  interface AuthMeta {
    required?: boolean
    scope?: 'user' | 'admin'
  }

  const [authMeta, getAuthMeta] = defineMeta(
    'auth',
    (incoming: AuthMeta, current) => ({ ...current, ...incoming }),
  )

  const requiredAuthProcedure = oc.meta(authMeta({ required: true }))
  const adminAuthProcedure = oc.meta(authMeta({ scope: 'admin' }))
  const requiredAndAdminProcedure = oc.meta(authMeta({ required: true, scope: 'user' })).meta(authMeta({ scope: 'admin' }))

  expect(getAuthMeta(oc)).toBeUndefined()
  expect(getAuthMeta(requiredAuthProcedure)).toEqual({ required: true })
  expect(getAuthMeta(adminAuthProcedure)).toEqual({ scope: 'admin' })
  expect(getAuthMeta(requiredAndAdminProcedure)).toEqual({ required: true, scope: 'admin' })
})
