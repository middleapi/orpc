import type { AnyMetaPlugin } from './meta'
import { oc } from './builder'
import { defineMeta, resolveAugmentedMetaPlugins, resolveMetaPlugins } from './meta-utils'

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

describe('resolveAugmentedMetaPlugins', () => {
  const plugin1 = {
    name: 'plugin1',
    init: vi.fn(m => ({ ...m, p1: [...(m.p1 as any[] ?? []), 1] })),
  } satisfies AnyMetaPlugin
  const plugin2 = {
    name: 'plugin2',
    init: vi.fn(m => ({ ...m, p2: [...(m.p2 as any[] ?? []), 2] })),
  } satisfies AnyMetaPlugin
  const plugin3 = {
    name: 'plugin3',
    init: vi.fn(m => ({ ...m, p3: true })),
  } satisfies AnyMetaPlugin

  it('dedupes target plugins already included in the router plugins', () => {
    expect(resolveAugmentedMetaPlugins({ p1: [1] }, [plugin1], [plugin1, plugin3], {}))
      .toEqual([{ p1: [1], p3: true }, [plugin1, plugin3]])

    expect(resolveAugmentedMetaPlugins({ p1: [1], p2: [2] }, [plugin1, plugin2], [plugin1], {}))
      .toEqual([{ p1: [1], p2: [2] }, [plugin1, plugin2]])

    // shared leading plugins only
    expect(resolveAugmentedMetaPlugins({ p1: [1], p2: [2] }, [plugin1, plugin2], [plugin1, plugin3], {}))
      .toEqual([{ p1: [1], p2: [2], p3: true }, [plugin1, plugin2, plugin3]])

    expect(plugin1.init).not.toHaveBeenCalled()
  })

  it('dedupes one occurrence of each shared plugin included in the router plugins', () => {
    expect(resolveAugmentedMetaPlugins({ p2: [2], p1: [1] }, [plugin2, plugin1], [plugin1], {}, [plugin1]))
      .toEqual([{ p2: [2], p1: [1] }, [plugin2, plugin1]])

    expect(resolveAugmentedMetaPlugins({ p2: [2], p1: [1] }, [plugin2, plugin1], [plugin3, plugin1], {}, [plugin1, plugin1]))
      .toEqual([{ p2: [2], p1: [1], p3: true }, [plugin2, plugin1, plugin3]])

    expect(resolveAugmentedMetaPlugins({ p2: [2], p1: [1] }, [plugin2, plugin1], [plugin1, plugin1], {}, [plugin1]))
      .toEqual([{ p2: [2], p1: [1, 1] }, [plugin2, plugin1, plugin1]])

    expect(resolveAugmentedMetaPlugins({ p1: [1] }, [plugin1], [plugin1, plugin1], {}, [plugin1]))
      .toEqual([{ p1: [1, 1] }, [plugin1, plugin1]])

    expect(resolveAugmentedMetaPlugins({ p2: [2] }, [plugin2], [plugin1], {}, [plugin1]))
      .toEqual([{ p2: [2], p1: [1] }, [plugin2, plugin1]])
  })

  it('does not dedupe when dedupeLeadingMetaPlugins is disabled', () => {
    expect(resolveAugmentedMetaPlugins({ p1: [1] }, [plugin1], [plugin1, plugin3], { dedupeLeadingMetaPlugins: false }))
      .toEqual(resolveMetaPlugins({ p1: [1] }, [plugin1], [plugin1, plugin3]))
  })

  it('does not dedupe shared plugins when dedupeLeadingMetaPlugins is disabled', () => {
    expect(resolveAugmentedMetaPlugins({ p2: [2], p1: [1] }, [plugin2, plugin1], [plugin1], { dedupeLeadingMetaPlugins: false }, [plugin1]))
      .toEqual(resolveMetaPlugins({ p2: [2], p1: [1] }, [plugin2, plugin1], [plugin1]))
  })

  it('resolves like resolveMetaPlugins when no leading plugins are shared', () => {
    expect(resolveAugmentedMetaPlugins({ p2: [2] }, [plugin2], [plugin1], {}))
      .toEqual(resolveMetaPlugins({ p2: [2] }, [plugin2], [plugin1]))

    expect(resolveAugmentedMetaPlugins({ p1: [1] }, [plugin1], [plugin2, plugin1], {}))
      .toEqual([{ p1: [1, 1], p2: [2] }, [plugin1, plugin2, plugin1]])

    expect(resolveAugmentedMetaPlugins({ base: true }, undefined, [plugin1], {}))
      .toEqual([{ base: true, p1: [1] }, [plugin1]])
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
