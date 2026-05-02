import type { AnyContractProcedure } from './procedure'
import { inputSchema, outputSchema, ping, pong, router } from '../tests/shared'
import { oc } from './builder'
import { isContractProcedure } from './procedure'
import { enhanceRoute } from './route'
import { enhanceContractRouter, getContractRouter, minifyContractRouter, populateContractRouterPaths } from './router-utils'

it('getContractRouter', () => {
  expect(getContractRouter(router, [])).toEqual(router)
  expect(getContractRouter(router, ['ping'])).toEqual(router.ping)
  expect(getContractRouter(router, ['nested', 'pong'])).toEqual(router.nested.pong)

  expect(getContractRouter(router, ['not-exist'])).toBeUndefined()
  expect(getContractRouter(router, ['nested', 'not-exist', 'not-exist'])).toBeUndefined()

  expect(getContractRouter(router, ['pong', '~orpc'])).toBeUndefined()
  expect(getContractRouter(router, ['ping', '~orpc'])).toBeUndefined()
})

it('enhanceContractRouter', async () => {
  const errorMap = {
    INVALID: { message: 'INVALID' },
    OVERRIDE: { message: 'OVERRIDE' },
  }
  const options = { errorMap, prefix: '/enhanced', tags: ['enhanced'] } as const

  const enhanced = enhanceContractRouter(router, options)

  expect(enhanced.ping['~orpc'].errorMap).toEqual({ ...errorMap, ...ping['~orpc'].errorMap })
  expect(enhanced.ping['~orpc'].route).toEqual(enhanceRoute(ping['~orpc'].route, options))

  expect(enhanced.pong['~orpc'].errorMap).toEqual({ ...errorMap, ...pong['~orpc'].errorMap })
  expect(enhanced.pong['~orpc'].route).toEqual(enhanceRoute(pong['~orpc'].route, options))

  expect(enhanced.nested.ping['~orpc'].errorMap).toEqual({ ...errorMap, ...ping['~orpc'].errorMap })
  expect(enhanced.nested.ping['~orpc'].route).toEqual(enhanceRoute(ping['~orpc'].route, options))

  expect(enhanced.nested.pong['~orpc'].errorMap).toEqual({ ...errorMap, ...pong['~orpc'].errorMap })
  expect(enhanced.nested.pong['~orpc'].route).toEqual(enhanceRoute(pong['~orpc'].route, options))
})

it('minifyContractRouter', () => {
  const minified = minifyContractRouter(router)

  const minifiedPing = {
    '~orpc': {
      errorMap: {},
      meta: {
        mode: 'dev',
      },
      route: {
        path: '/base',
      },
    },
  }

  const minifiedPong = {
    '~orpc': {
      errorMap: {},
      meta: {},
      route: {},
    },
  }

  expect((minified as any).ping).toSatisfy(isContractProcedure)
  expect((minified as any).ping).toEqual(minifiedPing)

  expect((minified as any).pong).toSatisfy(isContractProcedure)
  expect((minified as any).pong).toEqual(minifiedPong)

  expect((minified as any).nested.ping).toSatisfy(isContractProcedure)
  expect((minified as any).nested.ping).toEqual(minifiedPing)

  expect((minified as any).nested.pong).toSatisfy(isContractProcedure)
  expect((minified as any).nested.pong).toEqual(minifiedPong)
})

describe('contract modules that export primitives alongside procedures', () => {
  // Simulates: import * as userContract from './contracts/user'
  // where the module exports contract procedures AND constants like:
  //   export const getUser = oc.input(userSchema)
  //   export const listUsers = oc.input(listSchema)
  //   export const API_VERSION = 'v2'
  //   export const MAX_PAGE_SIZE = 100
  //   export const ENABLE_CACHE = true

  const moduleWithPrimitives = {
    getUser: ping,
    listUsers: pong,
    API_VERSION: 'v2',
    MAX_PAGE_SIZE: 100,
    ENABLE_CACHE: true,
    DEPRECATED: null,
    OPTIONAL_FEATURE: undefined,
  } as any

  describe('enhanceContractRouter', () => {
    const options = { errorMap: {}, prefix: '/api', tags: ['api'] } as const

    it('enhances procedures and passes through primitive exports', () => {
      const enhanced = enhanceContractRouter(moduleWithPrimitives, options) as unknown as {
        getUser: AnyContractProcedure
        listUsers: AnyContractProcedure
        API_VERSION: string
        MAX_PAGE_SIZE: number
        ENABLE_CACHE: boolean
      }
      expect(isContractProcedure(enhanced.getUser)).toBe(true)
      expect(isContractProcedure(enhanced.listUsers)).toBe(true)
      expect(enhanced.API_VERSION).toBe('v2')
      expect(enhanced.MAX_PAGE_SIZE).toBe(100)
      expect(enhanced.ENABLE_CACHE).toBe(true)
    })

    it('handles single-character string exports without stack overflow', () => {
      // Single-char strings are the worst case: for...in on 'v' yields key '0',
      // and 'v'[0] === 'v' creates an infinite loop
      const moduleWithFlag = { getUser: ping, v: 'v' } as any
      expect(() => enhanceContractRouter(moduleWithFlag, options)).not.toThrow()
    })
  })

  describe('minifyContractRouter', () => {
    it('minifies procedures and passes through primitive exports', () => {
      const minified = minifyContractRouter(moduleWithPrimitives)
      expect(isContractProcedure((minified as any).getUser)).toBe(true)
      expect(isContractProcedure((minified as any).listUsers)).toBe(true)
      expect((minified as any).API_VERSION).toBe('v2')
      expect((minified as any).MAX_PAGE_SIZE).toBe(100)
    })

    it('handles single-character string exports without stack overflow', () => {
      const moduleWithFlag = { getUser: ping, v: 'v' } as any
      expect(() => minifyContractRouter(moduleWithFlag)).not.toThrow()
    })
  })

  describe('populateContractRouterPaths', () => {
    it('populates procedure paths and passes through primitive exports', () => {
      const moduleForPaths = {
        getUser: oc.input(inputSchema),
        listUsers: oc.output(outputSchema),
        API_VERSION: 'v2',
        MAX_PAGE_SIZE: 100,
        ENABLE_CACHE: true,
      } as any
      const populated = populateContractRouterPaths(moduleForPaths) as unknown as {
        getUser: AnyContractProcedure
        listUsers: AnyContractProcedure
        API_VERSION: string
        MAX_PAGE_SIZE: number
        ENABLE_CACHE: boolean
      }
      expect(isContractProcedure(populated.getUser)).toBe(true)
      expect(populated.getUser['~orpc'].route.path).toBe('/getUser')
      expect(isContractProcedure(populated.listUsers)).toBe(true)
      expect(populated.listUsers['~orpc'].route.path).toBe('/listUsers')
      expect(populated.API_VERSION).toBe('v2')
      expect(populated.MAX_PAGE_SIZE).toBe(100)
    })

    it('handles single-character string exports without stack overflow', () => {
      const moduleWithFlag = { getUser: oc.input(inputSchema), v: 'v' } as any
      expect(() => populateContractRouterPaths(moduleWithFlag)).not.toThrow()
    })
  })

  describe('getContractRouter', () => {
    it('returns undefined when path traverses past a primitive export', () => {
      expect(getContractRouter(moduleWithPrimitives, ['API_VERSION', 'length'])).toBeUndefined()
      expect(getContractRouter(moduleWithPrimitives, ['MAX_PAGE_SIZE', 'toFixed'])).toBeUndefined()
      expect(getContractRouter(moduleWithPrimitives, ['ENABLE_CACHE', 'valueOf'])).toBeUndefined()
    })

    it('returns undefined for single-character string exports instead of indexed characters', () => {
      // Without the typeof guard, getContractRouter(['v', '0']) returns 'v'
      // because 'v'[0] === 'v', walking character indices instead of bailing out.
      const moduleWithFlag = { getUser: ping, v: 'v' } as any
      expect(getContractRouter(moduleWithFlag, ['v', '0'])).toBeUndefined()
      expect(getContractRouter(moduleWithFlag, ['v', '0', '0', '0'])).toBeUndefined()
    })
  })
})

it('populateContractRouterPaths', () => {
  const contract = {
    ping: oc.input(inputSchema),
    pong: oc.route({
      path: '/pong/{id}',
    }),
    nested: {
      ping: oc.output(outputSchema),
      pong: oc.route({
        path: '/pong2/{id}',
      }),
    },
  }

  const populated = populateContractRouterPaths(contract)

  expect(populated.pong['~orpc'].route.path).toBe('/pong/{id}')
  expect(populated.nested.pong['~orpc'].route.path).toBe('/pong2/{id}')

  expect(populated.ping['~orpc'].route.path).toBe('/ping')
  expect(populated.ping['~orpc'].inputSchema).toBe(inputSchema)

  expect(populated.nested.ping['~orpc'].route.path).toBe('/nested/ping')
  expect(populated.nested.ping['~orpc'].outputSchema).toBe(outputSchema)
})
