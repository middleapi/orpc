import type { AnyMetaPlugin } from './meta'
import { oc } from './builder'
import { defineMeta, mergeMetaPlugins, resolveMetaPlugins } from './meta-utils'

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

describe('resolveMetaPlugins dedupes plugin instances', () => {
  it('skips an incoming plugin already in existing', () => {
    const plugin = {
      name: 'plugin',
      init: vi.fn(m => ({ ...m, count: (m.count as number ?? 0) + 1 })),
      apply: vi.fn(m => ({ ...m, applied: (m.applied as number ?? 0) + 1 })),
    } satisfies AnyMetaPlugin

    const [meta, plugins] = resolveMetaPlugins({ count: 1 }, [plugin], [plugin])

    expect(plugin.init).not.toHaveBeenCalled()
    expect(plugin.apply).toHaveBeenCalledTimes(1)
    expect(plugins).toEqual([plugin])
    expect(meta).toEqual({ count: 1, applied: 1 })
  })

  it('inits a plugin repeated within incoming only once', () => {
    const plugin = {
      name: 'plugin',
      init: vi.fn(m => ({ ...m, count: (m.count as number ?? 0) + 1 })),
      apply: vi.fn(m => ({ ...m, applied: (m.applied as number ?? 0) + 1 })),
    } satisfies AnyMetaPlugin

    const [meta, plugins] = resolveMetaPlugins({}, undefined, [plugin, plugin])

    expect(plugin.init).toHaveBeenCalledTimes(1)
    expect(plugin.apply).toHaveBeenCalledTimes(1)
    expect(plugins).toEqual([plugin])
    expect(meta).toEqual({ count: 1, applied: 1 })
  })

  it('keeps distinct instances with the same name', () => {
    const plugin1 = { name: 'same', init: vi.fn(m => m) } satisfies AnyMetaPlugin
    const plugin2 = { name: 'same', init: vi.fn(m => m) } satisfies AnyMetaPlugin

    const [, plugins] = resolveMetaPlugins({}, [plugin1], [plugin1, plugin2])

    expect(plugin1.init).not.toHaveBeenCalled()
    expect(plugin2.init).toHaveBeenCalledTimes(1)
    expect(plugins).toEqual([plugin1, plugin2])
  })
})

it('mergeMetaPlugins', () => {
  const plugin1 = { name: 'same' } satisfies AnyMetaPlugin
  const plugin2 = { name: 'same' } satisfies AnyMetaPlugin
  const plugin3 = { name: 'other' } satisfies AnyMetaPlugin

  expect(mergeMetaPlugins()).toEqual([])
  expect(mergeMetaPlugins(undefined, [plugin1])).toEqual([plugin1])

  const merged = mergeMetaPlugins<AnyMetaPlugin>([plugin1, plugin2], undefined, [plugin2, plugin3, plugin1])
  expect(merged).toHaveLength(3)
  expect(merged[0]).toBe(plugin1)
  expect(merged[1]).toBe(plugin2)
  expect(merged[2]).toBe(plugin3)
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
