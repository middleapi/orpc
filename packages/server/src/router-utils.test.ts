import type { AnyProcedure } from './procedure'
import { enhanceRoute } from '@orpc/contract'
import { contract, ping, pingMiddleware, pong, router } from '../tests/shared'
import { getLazyMeta, isLazy, unlazy } from './lazy'
import { setHiddenRouterContract } from './router-hidden'
import { enhanceRouter, getRouter, resolveContractProcedures, traverseContractProcedures, unlazyRouter } from './router-utils'

it('getRouter', () => {
  expect(getRouter(router, [])).toEqual(router)
  expect(getRouter(router, ['ping'])).toEqual(router.ping)
  expect(getRouter(router, ['nested', 'pong'])).toSatisfy(isLazy)
  expect(unlazy(getRouter(router, ['nested', 'pong']))).resolves.toEqual({ default: pong })

  expect(getRouter(router, ['not-exist'])).toBeUndefined()
  expect(getRouter(router, ['nested', 'not-exist', 'not-exist'])).toSatisfy(isLazy)
  expect(unlazy(getRouter(router, ['nested', 'not-exist', 'not-exist']))).resolves.toEqual({ default: undefined })

  expect(getRouter(router, ['pong', '~orpc'])).toBeUndefined()
  expect(getRouter(router, ['ping', '~orpc'])).toSatisfy(isLazy)
  expect(unlazy(getRouter(router, ['ping', '~orpc']))).resolves.toEqual({ default: undefined })
})

describe('enhanceRouter', () => {
  it('works', async () => {
    const mid = vi.fn()
    const extraErrorMap = { EXTRA: {} }
    const options = {
      errorMap: extraErrorMap,
      middlewares: [mid, pingMiddleware],
      prefix: '/adapt',
      tags: ['adapt'],
      dedupeLeadingMiddlewares: false,
    } as const

    const enhanced = enhanceRouter(router, options)

    expect(enhanced.ping).toSatisfy(isLazy)
    expect((await unlazy(enhanced.ping)).default['~orpc'].middlewares).toEqual([mid, pingMiddleware, ...ping['~orpc'].middlewares])
    expect((await unlazy(enhanced.ping)).default['~orpc'].route).toEqual(enhanceRoute(ping['~orpc'].route, options))
    expect((await unlazy(enhanced.ping)).default['~orpc'].inputValidationIndex).toEqual(3)
    expect((await unlazy(enhanced.ping)).default['~orpc'].outputValidationIndex).toEqual(3)
    expect(getLazyMeta(enhanced.ping)).toEqual({ prefix: '/adapt' })

    expect(enhanced.pong['~orpc'].middlewares).toEqual([mid, pingMiddleware, ...pong['~orpc'].middlewares])
    expect(enhanced.pong['~orpc'].route).toEqual(enhanceRoute(pong['~orpc'].route, options))
    expect(enhanced.pong['~orpc'].inputValidationIndex).toEqual(2)
    expect(enhanced.pong['~orpc'].outputValidationIndex).toEqual(2)

    expect(enhanced.nested).toSatisfy(isLazy)
    expect(getLazyMeta(enhanced.nested)).toEqual({ prefix: '/adapt' })

    expect(enhanced.nested.ping).toSatisfy(isLazy)
    expect((await unlazy(enhanced.nested.ping)).default['~orpc'].middlewares).toEqual([mid, pingMiddleware, ...ping['~orpc'].middlewares])
    expect((await unlazy(enhanced.nested.ping)).default['~orpc'].route).toEqual(enhanceRoute(ping['~orpc'].route, options))
    expect((await unlazy(enhanced.nested.ping)).default['~orpc'].inputValidationIndex).toEqual(3)
    expect((await unlazy(enhanced.nested.ping)).default['~orpc'].outputValidationIndex).toEqual(3)
    expect(getLazyMeta(enhanced.nested.ping)).toEqual({ prefix: '/adapt' })

    expect(enhanced.nested.pong).toSatisfy(isLazy)
    expect((await unlazy(enhanced.nested.pong)).default['~orpc'].middlewares).toEqual([mid, pingMiddleware, ...pong['~orpc'].middlewares])
    expect((await unlazy(enhanced.nested.pong)).default['~orpc'].route).toEqual(enhanceRoute(pong['~orpc'].route, options))
    expect((await unlazy(enhanced.nested.pong)).default['~orpc'].inputValidationIndex).toEqual(2)
    expect((await unlazy(enhanced.nested.pong)).default['~orpc'].outputValidationIndex).toEqual(2)
    expect(getLazyMeta(enhanced.nested.pong)).toEqual({ prefix: '/adapt' })
  })

  it('can merge lazy prefix', async () => {
    const enhanced = enhanceRouter(
      enhanceRouter(router, { errorMap: {}, prefix: '/enhanced', tags: [], middlewares: [], dedupeLeadingMiddlewares: false }),
      { errorMap: {}, prefix: '/prefix', tags: [], middlewares: [], dedupeLeadingMiddlewares: false },
    )

    expect(getLazyMeta(enhanced.ping)).toEqual({ prefix: '/prefix/enhanced' })
    expect(getLazyMeta(enhanced.nested)).toEqual({ prefix: '/prefix/enhanced' })
    expect(getLazyMeta(enhanced.nested.ping)).toEqual({ prefix: '/prefix/enhanced' })
    expect(getLazyMeta(enhanced.nested.pong)).toEqual({ prefix: '/prefix/enhanced' })
  })

  it('can dedupeLeadingMiddlewares', async () => {
    const mid = vi.fn()
    const extraErrorMap = { EXTRA: {} }
    const options = {
      errorMap: extraErrorMap,
      middlewares: [pingMiddleware],
      dedupeLeadingMiddlewares: true,
    } as const

    const enhanced = enhanceRouter(router, options)

    expect(enhanced.ping).toSatisfy(isLazy)
    expect((await unlazy(enhanced.ping)).default['~orpc'].middlewares).toEqual(ping['~orpc'].middlewares)
    expect((await unlazy(enhanced.ping)).default['~orpc'].route).toEqual(ping['~orpc'].route)
    expect((await unlazy(enhanced.ping)).default['~orpc'].inputValidationIndex).toEqual(1)
    expect((await unlazy(enhanced.ping)).default['~orpc'].outputValidationIndex).toEqual(1)
  })
})

describe('traverseContractProcedures', () => {
  it('with contract', () => {
    const callback = vi.fn()

    expect(traverseContractProcedures({
      router: contract,
      path: [],
    }, callback)).toEqual([])

    expect(callback).toHaveBeenCalledTimes(4)

    expect(callback).toHaveBeenNthCalledWith(1, {
      contract: contract.ping,
      path: ['ping'],
    })

    expect(callback).toHaveBeenNthCalledWith(2, {
      contract: contract.pong,
      path: ['pong'],
    })

    expect(callback).toHaveBeenNthCalledWith(3, {
      contract: contract.nested.ping,
      path: ['nested', 'ping'],
    })

    expect(callback).toHaveBeenNthCalledWith(4, {
      contract: contract.nested.pong,
      path: ['nested', 'pong'],
    })
  })

  it('with router', () => {
    const callback = vi.fn()

    expect(traverseContractProcedures({
      router,
      path: [],
    }, callback)).toEqual([
      { path: ['ping'], router: router.ping },
      { path: ['nested'], router: router.nested },
    ])

    expect(callback).toHaveBeenCalledTimes(1)

    expect(callback).toHaveBeenNthCalledWith(1, {
      contract: router.pong,
      path: ['pong'],
    })
  })

  it('with hidden contract', () => {
    const callback = vi.fn()

    expect(traverseContractProcedures({
      router: setHiddenRouterContract(router, contract),
      path: [],
    }, callback)).toEqual([])

    expect(callback).toHaveBeenCalledTimes(4)

    expect(callback).toHaveBeenNthCalledWith(1, {
      contract: contract.ping,
      path: ['ping'],
    })

    expect(callback).toHaveBeenNthCalledWith(2, {
      contract: contract.pong,
      path: ['pong'],
    })

    expect(callback).toHaveBeenNthCalledWith(3, {
      contract: contract.nested.ping,
      path: ['nested', 'ping'],
    })

    expect(callback).toHaveBeenNthCalledWith(4, {
      contract: contract.nested.pong,
      path: ['nested', 'pong'],
    })
  })
})

it('resolveContractProcedures', async () => {
  const callback = vi.fn()

  expect(await resolveContractProcedures({
    router,
    path: [],
  }, callback)).toEqual(undefined)

  expect(callback).toHaveBeenCalledTimes(4)

  expect(callback).toHaveBeenNthCalledWith(1, {
    contract: router.pong,
    path: ['pong'],
  })

  expect(callback).toHaveBeenNthCalledWith(2, {
    contract: (await unlazy(router.ping)).default,
    path: ['ping'],
  })

  expect(callback).toHaveBeenNthCalledWith(3, {
    contract: (await unlazy(router.nested)).default.ping,
    path: ['nested', 'ping'],
  })

  expect(callback).toHaveBeenNthCalledWith(4, {
    contract: (await unlazy((await unlazy(router.nested)).default.pong)).default,
    path: ['nested', 'pong'],
  })
})

it('unlazyRouter', async () => {
  const unlazied = await unlazyRouter(router)

  expect(unlazied).toEqual({
    ping,
    pong,
    nested: {
      ping,
      pong,
    },
  })
})

describe('router modules that export primitives alongside procedures', () => {
  // Simulates: import * as userRouter from './routes/user'
  // where the module exports procedures AND constants like:
  //   export const getUser = os.handler(...)
  //   export const listUsers = os.handler(...)
  //   export const API_VERSION = 'v2'
  //   export const MAX_PAGE_SIZE = 100
  //   export const ENABLE_CACHE = true

  const moduleWithPrimitives = {
    getUser: pong,
    listUsers: pong,
    API_VERSION: 'v2',
    MAX_PAGE_SIZE: 100,
    ENABLE_CACHE: true,
    DEPRECATED: null,
    OPTIONAL_FEATURE: undefined,
  } as any

  const defaultOptions = {
    errorMap: {},
    middlewares: [],
    prefix: undefined,
    tags: [],
    dedupeLeadingMiddlewares: false,
  } as const

  describe('enhanceRouter', () => {
    it('enhances procedures and passes through primitive exports', () => {
      const enhanced = enhanceRouter(moduleWithPrimitives, defaultOptions) as unknown as {
        getUser: AnyProcedure
        listUsers: AnyProcedure
        API_VERSION: string
        MAX_PAGE_SIZE: number
        ENABLE_CACHE: boolean
      }
      expect(enhanced.getUser['~orpc']).toBeDefined()
      expect(enhanced.listUsers['~orpc']).toBeDefined()
      expect(enhanced.API_VERSION).toBe('v2')
      expect(enhanced.MAX_PAGE_SIZE).toBe(100)
      expect(enhanced.ENABLE_CACHE).toBe(true)
    })

    it('handles single-character string exports without stack overflow', () => {
      // Single-char strings are the worst case: for...in on 'v' yields key '0',
      // and 'v'[0] === 'v' creates an infinite loop
      const moduleWithFlag = { getUser: pong, v: 'v' } as any
      expect(() => enhanceRouter(moduleWithFlag, defaultOptions)).not.toThrow()
    })
  })

  describe('getRouter', () => {
    it('returns undefined when path traverses past a primitive export', () => {
      expect(getRouter(moduleWithPrimitives, ['API_VERSION', 'length'])).toBeUndefined()
      expect(getRouter(moduleWithPrimitives, ['MAX_PAGE_SIZE', 'toFixed'])).toBeUndefined()
      expect(getRouter(moduleWithPrimitives, ['ENABLE_CACHE', 'valueOf'])).toBeUndefined()
    })

    it('returns undefined for single-character string exports instead of indexed characters', () => {
      // Without the typeof guard, getRouter(['v', '0']) returns 'v' because
      // 'v'[0] === 'v', walking character indices instead of bailing out.
      const moduleWithFlag = { getUser: pong, v: 'v' } as any
      expect(getRouter(moduleWithFlag, ['v', '0'])).toBeUndefined()
      expect(getRouter(moduleWithFlag, ['v', '0', '0', '0'])).toBeUndefined()
    })
  })

  describe('traverseContractProcedures', () => {
    it('traverses procedures and skips primitive, null, and undefined exports', () => {
      const callback = vi.fn()
      expect(() =>
        traverseContractProcedures({ router: moduleWithPrimitives, path: [] }, callback),
      ).not.toThrow()
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith({ contract: pong, path: ['getUser'] })
      expect(callback).toHaveBeenCalledWith({ contract: pong, path: ['listUsers'] })
    })
  })

  describe('unlazyRouter', () => {
    it('resolves procedures and preserves primitive exports', async () => {
      const result = await unlazyRouter(moduleWithPrimitives)
      expect(result.getUser).toEqual(pong)
      expect(result.listUsers).toEqual(pong)
      expect(result.API_VERSION).toBe('v2')
      expect(result.MAX_PAGE_SIZE).toBe(100)
    })
  })
})
