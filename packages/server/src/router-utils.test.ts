import * as ContractModule from '@orpc/contract'
import { getOwn } from '@orpc/shared'
import { z } from 'zod'
import { Lazy, unlazy } from './lazy'
import { Procedure } from './procedure'
import { withHiddenRouterContract } from './router-hidden'
import { augmentImplementedRouter, augmentRouter, getRouter, mergeRouterMiddlewares, resolveContractProcedure, unlazyRouter, walkProcedureContractsAsync, walkProcedureContractsSync } from './router-utils'

const oc = ContractModule.oc
const resolveAugmentedMetaPluginsSpy = vi.spyOn(ContractModule, 'resolveAugmentedMetaPlugins')
const mergeErrorMapSpy = vi.spyOn(ContractModule, 'mergeErrorMap')

beforeEach(() => {
  vi.clearAllMocks()
})

const schema1 = z.object({ schema1: z.string() })
const schema2 = z.object({ schema2: z.string() })

function callable<T extends object>(value: T): T {
  return Object.assign(() => {}, value)
}

function middlewareEntries(middlewares: readonly unknown[]) {
  return middlewares.map(middleware => ({
    middleware,
    inputSchemasLengthAtUse: 0,
    outputSchemasLengthAtUse: 0,
  }))
}

const procedure1 = new Procedure({
  errorMap: {},
  meta: { p1: true },
  inputSchemas: [schema1],
  outputSchemas: [schema2],
  handler: vi.fn(),
  orderedMiddlewares: [],
  metaPlugins: [{ name: 'test', apply: vi.fn() }],
  disableInputValidation: false,
})

const procedure2 = new Procedure({
  errorMap: {
    ERR: {
      data: schema1,
      status: 400,
    },
  },
  meta: { p2: true },
  inputSchemas: [schema2],
  outputSchemas: [],
  handler: vi.fn(),
  orderedMiddlewares: [{ middleware: vi.fn() as any, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 0 }],
  disableOutputValidation: undefined,
})

/**
 * Router utilities should handle invalid routers/procedures
 * and support function-like routers/procedures.
 */
const router = {
  p1: procedure1,
  p2: procedure2,
  invalid: 'invalid' as any,
  nested: callable({
    p1: callable(procedure1),
    invalid: 'invalid' as any,
  }),
  lazy: new Lazy({
    loader: async () => ({
      default: {
        p1: procedure1,
        nested: callable({ p1: procedure1 }),
        invalid: 'invalid' as any,
      },
    }),
    meta: { lazy: true },
    metaPlugins: [{ name: 'test', apply: vi.fn() }],
  }),
}

async function unlazyDefault<T>(value: T): Promise<T extends Lazy<infer U> ? U : T> {
  return (await unlazy(value)).default
}

// procedure and lazy router built from a shared base: leading [mid1] and [plugin1]
const dedupeMid1 = vi.fn()
const dedupeMid2 = vi.fn()
const dedupePlugin1 = { name: 'plugin1', init: vi.fn(meta => ({ ...meta, plugin1: [...(meta.plugin1 ?? []), 1] })) }
const dedupePlugin2 = { name: 'plugin2', init: vi.fn(meta => ({ ...meta, plugin2: true })) }

const dedupeProcedure = new Procedure({
  errorMap: {},
  meta: { plugin1: [1], plugin2: true },
  metaPlugins: [dedupePlugin1, dedupePlugin2],
  inputSchemas: [schema1],
  outputSchemas: [],
  handler: vi.fn(),
  orderedMiddlewares: [
    { middleware: dedupeMid1, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 0 },
    { middleware: dedupeMid2, inputSchemasLengthAtUse: 1, outputSchemasLengthAtUse: 0 },
  ],
})

const dedupeLazy = new Lazy({ meta: { plugin1: [1] }, metaPlugins: [dedupePlugin1], loader: async () => ({ default: { procedure: dedupeProcedure } }) })

describe('augmentRouter', () => {
  function createAugmentOptions() {
    return {
      meta: { base: 'augmentRouter' },
      errorMap: {
        OVERRIDE: {
          data: schema1,
          status: 400,
        },
      },
      metaPlugins: [{ name: 'plugin1', init: vi.fn() }],
      middlewares: [vi.fn()],
      disableOutputValidation: true,
    }
  }

  function expectAugmentedProcedure(
    mergeCallIndex: number,
    resolveCallIndex: number,
    actual: any,
    original: any,
    options: ReturnType<typeof createAugmentOptions>,
  ) {
    const resolved = resolveAugmentedMetaPluginsSpy.mock.results[resolveCallIndex - 1]?.value

    expect(actual).toBeInstanceOf(Procedure)
    expect(actual).not.toBe(original)
    expect(mergeErrorMapSpy).toHaveBeenNthCalledWith(mergeCallIndex, options.errorMap, original['~orpc'].errorMap)
    expect(resolveAugmentedMetaPluginsSpy).toHaveBeenNthCalledWith(
      resolveCallIndex,
      options.meta,
      options.metaPlugins,
      original['~orpc'].metaPlugins,
      options,
    )
    expect(actual['~orpc']).toEqual({
      disableOutputValidation: true,
      ...original['~orpc'],
      orderedMiddlewares: [
        ...middlewareEntries(options.middlewares),
        ...original['~orpc'].orderedMiddlewares,
      ],
      errorMap: mergeErrorMapSpy.mock.results[mergeCallIndex - 1]?.value,
      meta: resolved?.[0],
      metaPlugins: resolved?.[1],
    })
  }

  function expectAugmentedLazy(
    resolveCallIndex: number,
    actual: any,
    original: any,
    options: ReturnType<typeof createAugmentOptions>,
  ) {
    const resolved = resolveAugmentedMetaPluginsSpy.mock.results[resolveCallIndex - 1]?.value

    expect(actual).toBeInstanceOf(Lazy)
    expect(actual).not.toBe(original)
    expect(resolveAugmentedMetaPluginsSpy).toHaveBeenNthCalledWith(
      resolveCallIndex,
      options.meta,
      options.metaPlugins,
      original['~orpc'].metaPlugins,
      options,
    )
    expect(actual['~orpc']).toEqual({
      ...original['~orpc'],
      loader: expect.any(Function),
      meta: resolved?.[0],
      metaPlugins: resolved?.[1],
    })
  }

  it('augments every procedure in nested and lazy routers', async () => {
    const options = createAugmentOptions()
    const augmented = augmentRouter(router, options)

    expect(augmented).not.toBe(router)
    expect(augmented.nested).not.toBe(router.nested)
    expect(augmented.invalid).toBe('invalid')
    expect(augmented.nested.invalid).toBe('invalid')

    const routerLazy = await unlazyDefault(router.lazy)
    const augmentedLazy = await unlazyDefault(augmented.lazy)

    expect(augmentedLazy).not.toBe(routerLazy)
    expect(augmentedLazy.invalid).toBe('invalid')

    expect(mergeErrorMapSpy).toHaveBeenCalledTimes(5)
    expect(resolveAugmentedMetaPluginsSpy).toHaveBeenCalledTimes(6)

    expectAugmentedProcedure(1, 1, augmented.p1, router.p1, options)
    expectAugmentedProcedure(2, 2, augmented.p2, router.p2, options)
    expectAugmentedProcedure(3, 3, augmented.nested.p1, router.nested.p1, options)
    expectAugmentedLazy(4, augmented.lazy, router.lazy, options)
    expectAugmentedProcedure(4, 5, augmentedLazy.p1, routerLazy.p1, options)
    expectAugmentedProcedure(5, 6, augmentedLazy.nested.p1, routerLazy.nested.p1, options)
  })

  it('augments a procedure passed as the root router', () => {
    const options = createAugmentOptions()
    const augmented = augmentRouter(router.p2, options)

    expect(mergeErrorMapSpy).toHaveBeenCalledTimes(1)
    expect(resolveAugmentedMetaPluginsSpy).toHaveBeenCalledTimes(1)

    expectAugmentedProcedure(1, 1, augmented, router.p2, options)
  })

  it('supports function-like routers passed as the root router', () => {
    const options = createAugmentOptions()
    const functionRouter = callable(router.nested)
    const augmented = augmentRouter(functionRouter, options)

    expect(augmented).not.toBe(functionRouter)
    expect(augmented.invalid).toBe('invalid')

    expect(mergeErrorMapSpy).toHaveBeenCalledTimes(1)
    expect(resolveAugmentedMetaPluginsSpy).toHaveBeenCalledTimes(1)

    expectAugmentedProcedure(1, 1, augmented.p1, router.nested.p1, options)
  })

  it('returns non-object router values as-is', () => {
    const options = createAugmentOptions()
    const invalid = 'invalid' as any

    expect(augmentRouter(invalid, options)).toBe(invalid)
    expect(mergeErrorMapSpy).not.toHaveBeenCalled()
    expect(resolveAugmentedMetaPluginsSpy).not.toHaveBeenCalled()
  })

  describe('dedupe', () => {
    it('dedupes leading middlewares and meta plugins', async () => {
      const options = {
        errorMap: {},
        meta: { plugin1: [1] },
        metaPlugins: [dedupePlugin1],
        middlewares: [dedupeMid1],
      }

      const augmented = augmentRouter({ procedure: dedupeProcedure, lazy: dedupeLazy }, options)

      expect(augmented.procedure['~orpc'].orderedMiddlewares).toEqual(dedupeProcedure['~orpc'].orderedMiddlewares)
      expect(augmented.procedure['~orpc'].meta).toEqual(dedupeProcedure['~orpc'].meta)
      expect(augmented.procedure['~orpc'].metaPlugins).toEqual(dedupeProcedure['~orpc'].metaPlugins)

      expect(augmented.lazy['~orpc'].meta).toEqual({ plugin1: [1] })
      expect(augmented.lazy['~orpc'].metaPlugins).toEqual([dedupePlugin1])

      const unlaziedProcedure = (await unlazyDefault(augmented.lazy)).procedure
      expect(unlaziedProcedure['~orpc'].orderedMiddlewares).toEqual(dedupeProcedure['~orpc'].orderedMiddlewares)
      expect(unlaziedProcedure['~orpc'].meta).toEqual(dedupeProcedure['~orpc'].meta)
    })

    it('does not dedupe non-leading middlewares and meta plugins', () => {
      const options = {
        errorMap: {},
        meta: { plugin2: true },
        metaPlugins: [dedupePlugin2],
        middlewares: [dedupeMid2],
      }

      const augmented = augmentRouter(dedupeProcedure, options)

      expect(augmented['~orpc'].orderedMiddlewares).toEqual([
        ...middlewareEntries([dedupeMid2]),
        ...dedupeProcedure['~orpc'].orderedMiddlewares,
      ])
      expect(augmented['~orpc'].metaPlugins).toEqual([dedupePlugin2, dedupePlugin1, dedupePlugin2])
    })

    it('does not dedupe middlewares when dedupeLeadingMiddlewares is disabled', () => {
      const options = {
        errorMap: {},
        meta: { plugin1: [1] },
        metaPlugins: [dedupePlugin1],
        middlewares: [dedupeMid1],
        dedupeLeadingMiddlewares: false,
      }

      const augmented = augmentRouter(dedupeProcedure, options)

      expect(augmented['~orpc'].orderedMiddlewares).toEqual([
        ...middlewareEntries([dedupeMid1]),
        ...dedupeProcedure['~orpc'].orderedMiddlewares,
      ])
      // meta plugins are still deduped
      expect(augmented['~orpc'].meta).toEqual(dedupeProcedure['~orpc'].meta)
    })

    it('does not dedupe meta plugins when dedupeLeadingMetaPlugins is disabled', async () => {
      const options = {
        errorMap: {},
        meta: { plugin1: [1] },
        metaPlugins: [dedupePlugin1],
        middlewares: [dedupeMid1],
        dedupeLeadingMetaPlugins: false,
      }

      const augmented = augmentRouter({ procedure: dedupeProcedure, lazy: dedupeLazy }, options)

      expect(augmented.procedure['~orpc'].metaPlugins).toEqual([dedupePlugin1, dedupePlugin1, dedupePlugin2])
      expect(augmented.procedure['~orpc'].meta).toEqual({ plugin1: [1, 1], plugin2: true })
      expect(augmented.lazy['~orpc'].metaPlugins).toEqual([dedupePlugin1, dedupePlugin1])
      expect((await unlazyDefault(augmented.lazy)).procedure['~orpc'].metaPlugins).toEqual([dedupePlugin1, dedupePlugin1, dedupePlugin2])

      // middlewares are still deduped
      expect(augmented.procedure['~orpc'].orderedMiddlewares).toEqual(dedupeProcedure['~orpc'].orderedMiddlewares)
    })
  })
})

describe('augmentImplementedRouter', () => {
  function createImplementedOptions() {
    return {
      middlewares: [vi.fn()],
      disableOutputValidation: true,
    }
  }

  function expectImplementedProcedure(
    actual: any,
    original: any,
    options: ReturnType<typeof createImplementedOptions>,
  ) {
    expect(actual).toBeInstanceOf(Procedure)
    expect(actual).not.toBe(original)
    expect(actual['~orpc']).toEqual({
      disableOutputValidation: true,
      ...original['~orpc'],
      orderedMiddlewares: [
        ...middlewareEntries(options.middlewares),
        ...original['~orpc'].orderedMiddlewares,
      ],
    })
  }

  it('augments every procedure in nested and lazy routers', async () => {
    const options = createImplementedOptions()
    const augmented = augmentImplementedRouter(router, options)

    expect(augmented).not.toBe(router)
    expect(augmented.nested).not.toBe(router.nested)
    expect(augmented.invalid).toBe('invalid')
    expect(augmented.nested.invalid).toBe('invalid')
    expect(augmented.lazy).toBeInstanceOf(Lazy)
    expect(augmented.lazy).not.toBe(router.lazy)

    const routerLazy = await unlazyDefault(router.lazy)
    const augmentedLazy = await unlazyDefault(augmented.lazy)

    expect(augmented.lazy['~orpc']).toEqual({
      ...router.lazy['~orpc'],
      loader: expect.any(Function),
    })

    expect(augmentedLazy).not.toBe(routerLazy)
    expect(augmentedLazy.invalid).toBe('invalid')

    expectImplementedProcedure(augmented.p1, router.p1, options)
    expectImplementedProcedure(augmented.p2, router.p2, options)
    expectImplementedProcedure(augmented.nested.p1, router.nested.p1, options)
    expectImplementedProcedure(augmentedLazy.p1, routerLazy.p1, options)
    expectImplementedProcedure(augmentedLazy.nested.p1, routerLazy.nested.p1, options)

    expect(mergeErrorMapSpy).not.toHaveBeenCalled()
    expect(resolveAugmentedMetaPluginsSpy).not.toHaveBeenCalled()
  })

  it('augments a procedure passed as the root router', () => {
    const options = createImplementedOptions()
    const augmented = augmentImplementedRouter(router.p1, options)

    expectImplementedProcedure(augmented, router.p1, options)
    expect(mergeErrorMapSpy).not.toHaveBeenCalled()
    expect(resolveAugmentedMetaPluginsSpy).not.toHaveBeenCalled()
  })

  it('supports function-like routers passed as the root router', () => {
    const options = createImplementedOptions()
    const functionRouter = callable(router.nested)
    const augmented = augmentImplementedRouter(functionRouter, options)

    expect(augmented).not.toBe(functionRouter)
    expect(augmented.invalid).toBe('invalid')

    expectImplementedProcedure(augmented.p1, router.nested.p1, options)
    expect(mergeErrorMapSpy).not.toHaveBeenCalled()
    expect(resolveAugmentedMetaPluginsSpy).not.toHaveBeenCalled()
  })

  it('returns non-object router values as-is', () => {
    const options = createImplementedOptions()
    const invalid = 'invalid' as any

    expect(augmentImplementedRouter(invalid, options)).toBe(invalid)
  })

  it('dedupes leading middlewares', () => {
    expect(augmentImplementedRouter(dedupeProcedure, { middlewares: [dedupeMid1] })['~orpc'].orderedMiddlewares)
      .toEqual(dedupeProcedure['~orpc'].orderedMiddlewares)

    expect(augmentImplementedRouter(dedupeProcedure, { middlewares: [dedupeMid1], dedupeLeadingMiddlewares: false })['~orpc'].orderedMiddlewares)
      .toEqual([...middlewareEntries([dedupeMid1]), ...dedupeProcedure['~orpc'].orderedMiddlewares])
  })
})

describe('mergeRouterMiddlewares', () => {
  const mid1 = vi.fn()
  const mid2 = vi.fn()
  const mid3 = vi.fn()

  const ordered = [
    { middleware: mid1, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 0 },
    { middleware: mid2 }, // e.g. contract implementer, lengths default to 0
    { middleware: mid3, inputSchemasLengthAtUse: 1, outputSchemasLengthAtUse: 0 },
  ]

  it('dedupes leading middlewares by default', () => {
    expect(mergeRouterMiddlewares([mid1], ordered, {})).toBe(ordered)
    expect(mergeRouterMiddlewares([mid1, mid2], ordered, {})).toBe(ordered)
  })

  it('does not dedupe leading middlewares applied after an input/output schema', () => {
    expect(mergeRouterMiddlewares([mid1, mid2, mid3], ordered, {}))
      .toEqual([...middlewareEntries([mid1, mid2, mid3]), ...ordered])

    const afterOutput = [{ middleware: mid1, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 1 }]
    expect(mergeRouterMiddlewares([mid1], afterOutput, {}))
      .toEqual([...middlewareEntries([mid1]), ...afterOutput])
  })

  it('prepends middlewares that are not leading', () => {
    expect(mergeRouterMiddlewares([mid2], ordered, {})).toEqual([...middlewareEntries([mid2]), ...ordered])
    expect(mergeRouterMiddlewares([mid2, mid1], ordered, {})).toEqual([...middlewareEntries([mid2, mid1]), ...ordered])
    expect(mergeRouterMiddlewares([mid1, mid3], ordered, {})).toEqual([...middlewareEntries([mid1, mid3]), ...ordered])
    expect(mergeRouterMiddlewares([mid1, mid2, mid3, mid1], ordered, {})).toEqual([...middlewareEntries([mid1, mid2, mid3, mid1]), ...ordered])
  })

  it('does not dedupe when dedupeLeadingMiddlewares is disabled', () => {
    expect(mergeRouterMiddlewares([mid1], ordered, { dedupeLeadingMiddlewares: false }))
      .toEqual([...middlewareEntries([mid1]), ...ordered])
  })
})

describe('getRouter', () => {
  it('returns routers and procedures for valid paths', () => {
    expect(getRouter(router, [])).toBe(router)
    expect(getRouter(router, ['p1'])).toBe(router.p1)
    expect(getRouter(router, ['nested'])).toBe(router.nested)
    expect(getRouter(router, ['nested', 'p1'])).toBe(router.nested.p1)

    expect(getRouter(router.p1, [])).toBe(router.p1)
    expect(getRouter(router.lazy, [])).toBe(router.lazy)
    expect(getRouter(router.nested, [])).toBe(router.nested)
  })

  it('returns lazy routers for paths that cross a lazy router', async () => {
    const routerLazy = await unlazyDefault(router.lazy)

    const lazyP1 = getRouter(router, ['lazy', 'p1'])
    expect(lazyP1).toBeInstanceOf(Lazy)
    expect(await unlazyDefault(lazyP1)).toBe(routerLazy.p1)

    const lazyNestedP1 = getRouter(router, ['lazy', 'nested', 'p1'])
    expect(lazyNestedP1).toBeInstanceOf(Lazy)
    expect(await unlazyDefault(lazyNestedP1)).toBe(routerLazy.nested.p1)

    const lazyInvalid = getRouter(router, ['lazy', 'invalid'])
    expect(lazyInvalid).toBeInstanceOf(Lazy)
    expect(await unlazyDefault(lazyInvalid)).toBeUndefined()
  })

  it('returns undefined for invalid paths', () => {
    expect(getRouter(router, ['notExist'])).toBeUndefined()
    expect(getRouter(router, ['p1', '~orpc'])).toBeUndefined()
    expect(getRouter(router, ['invalid'])).toBeUndefined()
    expect(getRouter(router, ['invalid', 'notExists'])).toBeUndefined()
    expect(getRouter('invalid' as any, [])).toBeUndefined()
    expect(getRouter('invalid' as any, ['invalid'])).toBeUndefined()
    expect(getRouter(router, ['__proto__'])).toBeUndefined()
    expect(getRouter(router, ['nested', 'hasOwnProperty'])).toBeUndefined()
  })
})

describe('resolveContractProcedure', () => {
  const contract = oc.input(schema1).output(schema2)

  it('returns procedures as is', async () => {
    expect(await resolveContractProcedure(router, procedure1, ['p1'])).toBe(procedure1)
  })

  it('resolves contract-first implementations by path, including lazy ones', async () => {
    const resolved = await resolveContractProcedure(router, contract, ['p1'])
    expect(resolved).toBeInstanceOf(Procedure)
    expect(resolved['~orpc'].handler).toBe(procedure1['~orpc'].handler)

    expect(await resolveContractProcedure(router, contract, ['lazy', 'p1'])).toBeInstanceOf(Procedure)
  })

  it('throws when an implementation is missing or invalid', async () => {
    await expect(resolveContractProcedure(router, contract, ['notExist'])).rejects.toThrow(
      '[Contract-First] Missing or invalid implementation for procedure at path: "notExist".',
    )
    await expect(resolveContractProcedure(router, contract, ['invalid'])).rejects.toThrow(TypeError)
  })
})

describe('walkProcedureContractsSync', () => {
  it('walks procedure contracts and returns lazy routers', () => {
    const entries = vi.fn()
    const result = walkProcedureContractsSync(router, entries)

    expect(entries).toHaveBeenCalledTimes(3)
    expect(entries).toHaveBeenNthCalledWith(1, router.p1, ['p1'])
    expect(entries).toHaveBeenNthCalledWith(2, router.p2, ['p2'])
    expect(entries).toHaveBeenNthCalledWith(3, router.nested.p1, ['nested', 'p1'])
    expect(result).toEqual([{ path: ['lazy'], router: router.lazy }])
  })

  it('uses hidden function-like contracts instead of the runtime router', () => {
    const contract = {
      p1: oc.errors({ BAD_GATEWAY: {} }),
      nested: callable({
        p2: callable(oc.errors({ CONFLICT: {} })),
      }),
    }

    const withHiddenContract = withHiddenRouterContract(router, contract)
    const entries = vi.fn()
    const result = walkProcedureContractsSync(withHiddenContract, entries)

    expect(entries).toHaveBeenCalledTimes(2)
    expect(entries).toHaveBeenNthCalledWith(1, contract.p1, ['p1'])
    expect(entries).toHaveBeenNthCalledWith(2, contract.nested.p2, ['nested', 'p2'])
    expect(result).toEqual([])
  })

  it('supports a custom base path', () => {
    const entries = vi.fn()

    walkProcedureContractsSync(router, entries, ['custom'])

    expect(entries).toHaveBeenNthCalledWith(1, router.p1, ['custom', 'p1'])
    expect(entries).toHaveBeenNthCalledWith(2, router.p2, ['custom', 'p2'])
    expect(entries).toHaveBeenNthCalledWith(3, router.nested.p1, ['custom', 'nested', 'p1'])
  })

  it('ignores invalid roots', () => {
    const entries = vi.fn()

    expect(walkProcedureContractsSync('invalid' as any, entries)).toEqual([])
    expect(entries).not.toHaveBeenCalled()
  })
})

describe('walkProcedureContractsAsync', () => {
  it('awaits async callbacks while traversing normal and lazy routers', async () => {
    const events: string[] = []

    await walkProcedureContractsAsync(router, async (contract, path) => {
      events.push(`start:${path.join('.')}`)
      await Promise.resolve()
      events.push(`end:${path.join('.')}`)

      if (path[0] === 'lazy') {
        const lazied = getRouter(router, path)
        expect(lazied).toBeInstanceOf(Lazy)
        expect(contract).toBe(await unlazyDefault(lazied))
      }
      else {
        expect(contract).toBe(getRouter(router, path))
      }
    })

    expect(events).toEqual([
      'start:p1',
      'end:p1',
      'start:p2',
      'end:p2',
      'start:nested.p1',
      'end:nested.p1',
      'start:lazy.p1',
      'end:lazy.p1',
      'start:lazy.nested.p1',
      'end:lazy.nested.p1',
    ])
  })

  it('uses hidden function-like contracts instead of the runtime router', async () => {
    const contract = {
      p1: oc.errors({ BAD_GATEWAY: {} }),
      invalid: 'invalid' as any,
      nested: callable({
        p2: callable(oc.errors({ CONFLICT: {} })),
        invalid: 'invalid' as any,
      }),
    }

    const withHiddenContract = withHiddenRouterContract(router, contract)
    const entries = vi.fn(async () => {})

    await walkProcedureContractsAsync(withHiddenContract, entries)

    expect(entries).toHaveBeenCalledTimes(2)
    expect(entries).toHaveBeenNthCalledWith(1, contract.p1, ['p1'])
    expect(entries).toHaveBeenNthCalledWith(2, contract.nested.p2, ['nested', 'p2'])
  })

  it('supports a custom base path', async () => {
    const entries = vi.fn(async () => {})
    const routerLazy = await unlazyDefault(router.lazy)

    await walkProcedureContractsAsync(router, entries, ['custom'])

    expect(entries).toHaveBeenCalledTimes(5)
    expect(entries).toHaveBeenNthCalledWith(1, router.p1, ['custom', 'p1'])
    expect(entries).toHaveBeenNthCalledWith(2, router.p2, ['custom', 'p2'])
    expect(entries).toHaveBeenNthCalledWith(3, router.nested.p1, ['custom', 'nested', 'p1'])
    expect(entries).toHaveBeenNthCalledWith(4, routerLazy.p1, ['custom', 'lazy', 'p1'])
    expect(entries).toHaveBeenNthCalledWith(5, routerLazy.nested.p1, ['custom', 'lazy', 'nested', 'p1'])
  })
})

describe('unlazyRouter', () => {
  it('unlazies nested lazy routers', async () => {
    const nestedRouter = {
      p1: procedure1,
      p2: new Lazy({
        loader: async () => ({ default: procedure2 }),
        meta: {},
      }),
      nested: new Lazy({
        loader: async () => ({
          default: {
            p1: procedure1,
            p2: new Lazy({
              loader: async () => ({ default: procedure2 }),
              meta: {},
            }),
          },
        }),
        meta: {},
      }),
    }

    const unlazied = await unlazyRouter(nestedRouter)

    expect(unlazied).toEqual({
      p1: procedure1,
      p2: procedure2,
      nested: {
        p1: procedure1,
        p2: procedure2,
      },
    })
  })

  it('returns procedures and non-object values as-is', async () => {
    expect(await unlazyRouter(router.p1)).toBe(router.p1)
    expect(await unlazyRouter('invalid' as any)).toBe('invalid')
  })
})

describe('__proto__ keys are kept as own routes instead of re-parenting the rebuilt router', () => {
  const procedure = new Procedure({
    errorMap: {},
    meta: {},
    orderedMiddlewares: [],
    handler: () => {},
  })

  // Object.fromEntries creates an own `__proto__` key, like a computed key or JSON.parse does
  const withProto = <T>(value: T): Record<string, T> => Object.fromEntries([['__proto__', value], ['other', value]])

  function expectOwnRoutes(router: any): void {
    expect(Object.getPrototypeOf(router)).toBe(Object.prototype)
    expect(router).not.toBeInstanceOf(Procedure)
    expect(Object.keys(router)).toEqual(['__proto__', 'other'])
    expect(Object.hasOwn(router, '__proto__')).toBe(true)
    expect(getOwn(router, '__proto__')).toBeInstanceOf(Procedure)
  }

  it('augmentRouter', () => {
    expectOwnRoutes(augmentRouter(withProto(procedure), { errorMap: {}, meta: {}, middlewares: [] }))
  })

  it('augmentImplementedRouter', () => {
    expectOwnRoutes(augmentImplementedRouter(withProto(procedure), { middlewares: [({ next }) => next()] }))
  })

  it('unlazyRouter', async () => {
    expectOwnRoutes(await unlazyRouter(withProto(new Lazy({ meta: {}, loader: async () => ({ default: procedure }) }))))
  })
})
