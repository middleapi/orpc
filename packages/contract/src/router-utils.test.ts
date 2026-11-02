import type { AnyMetaPlugin } from './meta'
import { z } from 'zod'
import { oc } from './builder'
import * as ErrorUtilsModule from './error-utils'
import * as MetaUtilsModule from './meta-utils'
import { defineMeta } from './meta-utils'
import { ProcedureContract } from './procedure'
import { augmentContractRouter, getProcedureContractOrThrow, getRouterContract, minifyRouterContract } from './router-utils'

const mergeErrorMapSpy = vi.spyOn(ErrorUtilsModule, 'mergeErrorMap')
const resolveMetaPluginsSpy = vi.spyOn(MetaUtilsModule, 'resolveMetaPlugins')

beforeEach(() => {
  mergeErrorMapSpy.mockClear()
  resolveMetaPluginsSpy.mockClear()
})

const schema1 = z.object({ schema1: z.string() })
const schema2 = z.object({ schema2: z.string() })

function callable<T extends object>(value: T): T {
  return Object.assign(() => {}, value)
}

const meta1: AnyMetaPlugin = {
  name: 'meta1',
  init(meta) {
    return {
      ...meta,
      meta1: true,
    }
  },
}

const meta2: AnyMetaPlugin = {
  name: 'meta2',
  init(meta) {
    return {
      ...meta,
      meta2: true,
    }
  },
}

/**
 * Router utilities should handle invalid routers/procedures
 * and support function-like routers/procedures.
 */
const router = {
  ping: new ProcedureContract({
    errorMap: {},
    meta: { ping: true },
    inputSchemas: [schema1],
    outputSchemas: [schema2],
  }),
  pong: new ProcedureContract({
    errorMap: {
      PONG_ERROR: {
        data: schema1,
        message: 'pong error',
      },
    },
    meta: { pong: true, meta2: true },
    inputSchemas: [schema1, schema2],
    outputSchemas: [],
    metaPlugins: [meta2],
  }),
  invalid: 'invalid' as any,
  nested: callable({
    ping: callable(new ProcedureContract({
      errorMap: {
        NESTED_PING_ERROR: {
          data: schema2,
        },
      },
      meta: { nestedPing: true },
      inputSchemas: [],
      outputSchemas: [schema2],
    })),
    invalid: 'invalid' as any,
  }),
}

describe('augmentContractRouter', () => {
  function createAugmentOptions() {
    return {
      meta: { base: 'augmentContractRouter' },
      errorMap: {
        OVERRIDE: {
          data: schema1,
        },
      },
      metaPlugins: [meta1],
    }
  }

  function expectAugmentedProcedure(
    callIndex: number,
    actual: any,
    original: any,
    options: ReturnType<typeof createAugmentOptions>,
  ) {
    const resolved = resolveMetaPluginsSpy.mock.results[callIndex - 1]?.value

    expect(actual).toBeInstanceOf(ProcedureContract)
    expect(actual).not.toBe(original)
    expect(mergeErrorMapSpy).toHaveBeenNthCalledWith(callIndex, options.errorMap, original['~orpc'].errorMap)
    expect(resolveMetaPluginsSpy).toHaveBeenNthCalledWith(
      callIndex,
      options.meta,
      options.metaPlugins,
      original['~orpc'].metaPlugins ?? [],
    )
    expect(actual['~orpc']).toEqual({
      ...original['~orpc'],
      errorMap: mergeErrorMapSpy.mock.results[callIndex - 1]?.value,
      meta: resolved?.[0],
      metaPlugins: resolved?.[1],
    })
  }

  it('augments every procedure in nested routers', () => {
    const options = createAugmentOptions()
    const augmented = augmentContractRouter(router, options)

    expect(augmented).not.toBe(router)
    expect(augmented.nested).not.toBe(router.nested)
    expect(augmented.invalid).toBe('invalid')
    expect(augmented.nested.invalid).toBe('invalid')

    expect(mergeErrorMapSpy).toHaveBeenCalledTimes(3)
    expect(resolveMetaPluginsSpy).toHaveBeenCalledTimes(3)

    expectAugmentedProcedure(1, augmented.ping, router.ping, options)
    expectAugmentedProcedure(2, augmented.pong, router.pong, options)
    expectAugmentedProcedure(3, augmented.nested.ping, router.nested.ping, options)
  })

  it('augments a procedure passed as the root router', () => {
    const options = createAugmentOptions()
    const augmented = augmentContractRouter(router.pong, options)

    expect(mergeErrorMapSpy).toHaveBeenCalledTimes(1)
    expect(resolveMetaPluginsSpy).toHaveBeenCalledTimes(1)

    expectAugmentedProcedure(1, augmented, router.pong, options)
  })

  it('supports function-like routers passed as the root router', () => {
    const options = createAugmentOptions()
    const functionRouter = callable(router.nested)
    const augmented = augmentContractRouter(functionRouter, options)

    expect(augmented).not.toBe(functionRouter)
    expect(augmented.invalid).toBe('invalid')

    expect(mergeErrorMapSpy).toHaveBeenCalledTimes(1)
    expect(resolveMetaPluginsSpy).toHaveBeenCalledTimes(1)

    expectAugmentedProcedure(1, augmented.ping, router.nested.ping, options)
  })

  it('does not re-initialize or re-apply plugins the procedure already carries', () => {
    const [prefix, getPrefix] = defineMeta('prefix', (incoming: string, current) => (current ?? '') + incoming)

    const base = oc.meta(prefix('/users'))
    const router = base.router({
      ping: base,
      nested: { ping: base.meta(prefix('/ping')) },
      other: oc.meta(prefix('/other')),
    })

    expect(getPrefix(base)).toBe('/users')
    expect(getPrefix(router.ping)).toBe('/users')
    expect(getPrefix(router.nested.ping)).toBe('/users/ping')
    expect(getPrefix(router.other)).toBe('/users/other')

    expect(router.ping['~orpc'].metaPlugins).toEqual(base['~orpc'].metaPlugins)
    expect(router.nested.ping['~orpc'].metaPlugins).toHaveLength(2)

    // augmenting again with the same builder is idempotent
    const again = base.router(router)
    expect(getPrefix(again.ping)).toBe('/users')
    expect(getPrefix(again.nested.ping)).toBe('/users/ping')
    expect(getPrefix(again.other)).toBe('/users/other')
  })

  it('calls init and apply of shared plugins once per resolution', () => {
    const plugin = {
      name: 'shared',
      init: vi.fn((meta: any) => ({ ...meta, count: (meta.count ?? 0) + 1 })),
      apply: vi.fn((meta: any) => ({ ...meta, applied: (meta.applied ?? 0) + 1 })),
    } satisfies AnyMetaPlugin

    const base = oc.meta(plugin)
    plugin.init.mockClear()
    plugin.apply.mockClear()

    const router = base.router({ ping: base })

    expect(plugin.init).not.toHaveBeenCalled()
    expect(plugin.apply).toHaveBeenCalledTimes(1)
    expect(router.ping['~orpc'].meta).toEqual({ count: 1, applied: 2 })
    expect(router.ping['~orpc'].metaPlugins).toEqual([plugin])
  })

  it('returns non-object router values as-is', () => {
    const options = createAugmentOptions()
    const invalid = 'invalid' as any

    expect(augmentContractRouter(invalid, options)).toBe(invalid)
    expect(mergeErrorMapSpy).not.toHaveBeenCalled()
    expect(resolveMetaPluginsSpy).not.toHaveBeenCalled()
  })
})

describe('getRouterContract', () => {
  it('returns routers and procedures for valid paths', () => {
    expect(getRouterContract(router, [])).toBe(router)
    expect(getRouterContract(router, ['ping'])).toBe(router.ping)
    expect(getRouterContract(router, ['nested'])).toBe(router.nested)
    expect(getRouterContract(router, ['nested', 'ping'])).toBe(router.nested.ping)

    expect(getRouterContract(router.ping, [])).toBe(router.ping)
    expect(getRouterContract(router.nested, [])).toBe(router.nested)
    expect(getRouterContract(router.nested, ['ping'])).toBe(router.nested.ping)
  })

  it('returns undefined for invalid paths', () => {
    expect(getRouterContract(router, ['notExist'])).toBeUndefined()
    expect(getRouterContract(router, ['notExist', 'notExist'])).toBeUndefined()

    expect(getRouterContract(router, ['invalid'])).toBeUndefined()
    expect(getRouterContract(router, ['invalid', 'notExist'])).toBeUndefined()
    expect(getRouterContract(router, ['nested', 'invalid'])).toBeUndefined()

    expect(getRouterContract(router, ['nested', 'ping', '~orpc'])).toBeUndefined()
    expect(getRouterContract(router, ['nested', 'ping', '~orpc', 'invalid'])).toBeUndefined()
    expect(getRouterContract(router.ping, ['invalid'])).toBeUndefined()

    expect(getRouterContract('invalid' as any, [])).toBeUndefined()
    expect(getRouterContract('invalid' as any, ['invalid'])).toBeUndefined()

    expect(getRouterContract(router, ['__proto__'])).toBeUndefined()
    expect(getRouterContract(router, ['nested', 'hasOwnProperty'])).toBeUndefined()
  })
})

describe('getProcedureContractOrThrow', () => {
  it('returns procedures for valid paths', () => {
    expect(getProcedureContractOrThrow(router, ['ping'])).toBe(router.ping)
    expect(getProcedureContractOrThrow(router, ['nested', 'ping'])).toBe(router.nested.ping)
    expect(getProcedureContractOrThrow(router.ping, [])).toBe(router.ping)
    expect(getProcedureContractOrThrow(router.nested, ['ping'])).toBe(router.nested.ping)
  })

  it('throws for non-procedure or invalid paths', () => {
    function noProcedureError(path: readonly string[]) {
      return new TypeError(`No valid procedure found at path "${path.join('.')}", this may happen when the router contract is not properly configured.`)
    }

    expect(() => getProcedureContractOrThrow(router, [])).toThrow(noProcedureError([]))
    expect(() => getProcedureContractOrThrow(router, ['nested'])).toThrow(noProcedureError(['nested']))
    expect(() => getProcedureContractOrThrow(router, ['notExist'])).toThrow(noProcedureError(['notExist']))
    expect(() => getProcedureContractOrThrow(router, ['invalid'])).toThrow(noProcedureError(['invalid']))
    expect(() => getProcedureContractOrThrow('invalid' as any, [])).toThrow(noProcedureError([]))
  })
})

describe('minifyRouterContract', () => {
  function expectMinifiedProcedure(actual: any, original: any) {
    expect(actual).toBeInstanceOf(ProcedureContract)
    expect(actual).not.toBe(original)
    expect(actual).toEqual({
      '~orpc': {
        errorMap: {},
        meta: original['~orpc'].meta,
      },
    })
  }

  it('minifies every procedure in nested routers', () => {
    const minified = minifyRouterContract(router) as any

    expect(minified).not.toBe(router)
    expect(minified.nested).not.toBe(router.nested)

    expectMinifiedProcedure(minified.ping, router.ping)
    expectMinifiedProcedure(minified.pong, router.pong)
    expectMinifiedProcedure(minified.nested.ping, router.nested.ping)

    expect(minified.invalid).toBe('invalid')
    expect(minified.nested.invalid).toBe('invalid')
  })

  it('minifies a procedure passed as the root router', () => {
    const minified = minifyRouterContract(router.pong)

    expectMinifiedProcedure(minified, router.pong)
  })

  it('supports function-like routers passed as the root router', () => {
    const functionRouter = callable(router.nested)
    const minified = minifyRouterContract(functionRouter) as any

    expect(minified).not.toBe(functionRouter)
    expectMinifiedProcedure(minified.ping, router.nested.ping)
    expect(minified.invalid).toBe('invalid')
  })

  it('returns non-object router values as-is', () => {
    const invalid = 'invalid' as any

    expect(minifyRouterContract(invalid)).toBe(invalid)
  })
})
