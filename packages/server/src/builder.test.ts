import type { Schema } from '@orpc/contract'
import { isContractProcedure } from '@orpc/contract'
import * as z from 'zod'
import { baseErrorMap, baseMeta, baseRoute, generalSchema, inputSchema, outputSchema } from '../../contract/tests/shared'
import { router } from '../tests/shared'
import { Builder } from './builder'
import { unlazy } from './lazy'
import * as MiddlewareDecorated from './middleware-decorated'
import { DecoratedProcedure } from './procedure-decorated'
import * as RouterUtilsModule from './router-utils'

const decorateMiddlewareSpy = vi.spyOn(MiddlewareDecorated, 'decorateMiddleware')
const enhanceRouterSpy = vi.spyOn(RouterUtilsModule, 'enhanceRouter')

const mid = vi.fn()

const def = {
  config: {
    initialInputValidationIndex: 11,
    initialOutputValidationIndex: 22,
  },
  middlewares: [mid],
  errorMap: baseErrorMap,
  inputSchema,
  outputSchema,
  inputValidationIndex: 99,
  meta: baseMeta,
  outputValidationIndex: 88,
  route: baseRoute,
  prefix: '/adapt' as const,
  tags: ['adapt'],
  dedupeLeadingMiddlewares: true,
}

const builder = new Builder(def)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('builder', () => {
  it('is a contract procedure', () => {
    expect(builder).toSatisfy(isContractProcedure)
  })

  it('.$config', () => {
    const config = {
      initialInputValidationIndex: Number.NEGATIVE_INFINITY,
      initialOutputValidationIndex: Number.POSITIVE_INFINITY,
      dedupeLeadingMiddlewares: false,
    }
    const applied = builder.$config(config)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      config,
      dedupeLeadingMiddlewares: false,
      inputValidationIndex: Number.NEGATIVE_INFINITY,
      outputValidationIndex: Number.POSITIVE_INFINITY,
    })
  })

  it('.$context', () => {
    const applied = builder.$context()

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      middlewares: [],
      inputValidationIndex: 11,
      outputValidationIndex: 22,
    })
  })

  it('.$meta', () => {
    const meta = { mode: 'test' }
    const applied = builder.$meta(meta)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      meta,
    })
  })

  it('.$route', () => {
    const route = { method: 'GET', description: 'test' } as const
    const applied = builder.$route(route)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      route,
    })
  })

  describe('.$input', () => {
    it('with actual schema', () => {
      const schema = z.void()
      const applied = builder.$input(schema)

      expect(applied).instanceOf(Builder)
      expect(applied).not.toBe(builder)
      expect(applied['~orpc']).toEqual({
        ...def,
        inputSchema: schema,
      })
    })

    it('with type only', () => {
      const applied = builder.$input<Schema<void, unknown>>()

      expect(applied).instanceOf(Builder)
      expect(applied).not.toBe(builder)
      expect(applied['~orpc']).toEqual({
        ...def,
        inputSchema: undefined,
      })
    })
  })

  it('.middleware', () => {
    const mid = vi.fn()
    const applied = builder.middleware(mid)

    expect(applied).toBe(decorateMiddlewareSpy.mock.results[0]?.value)
    expect(decorateMiddlewareSpy).toBeCalledTimes(1)
    expect(decorateMiddlewareSpy).toBeCalledWith(mid, def.errorMap)
  })

  it('.errors', () => {
    const errors = { BAD_GATEWAY: { message: 'BAD' } }

    const applied = builder.errors(errors)
    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)

    expect(applied['~orpc']).toEqual({
      ...def,
      errorMap: { ...def.errorMap, ...errors },
    })
  })

  describe('.use', () => {
    it('without map input', () => {
      const mid2 = vi.fn()
      const applied = builder.use(mid2)

      expect(applied).instanceOf(Builder)
      expect(applied).not.toBe(builder)
      expect(applied['~orpc']).toEqual({
        ...def,
        middlewares: [mid, mid2],
      })
    })

    it('with map input', () => {
      const mid2 = vi.fn()
      const map2 = vi.fn()

      decorateMiddlewareSpy.mockImplementationOnce(mid => ({
        mapInput: (map: any) => [mid, map] as any,
      }) as any)

      // @ts-expect-error --- this builder support .use with map input but not type
      const applied = builder.use(mid2, map2)

      expect(applied).instanceOf(Builder)
      expect(applied).not.toBe(builder)
      expect(applied['~orpc']).toEqual({
        ...def,
        middlewares: [mid, [mid2, map2]],
      })
    })
  })

  it('.meta', () => {
    const meta = { log: true } as any
    const applied = builder.meta(meta)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      meta: { ...def.meta, ...meta },
    })
  })

  it('.route', () => {
    const route = { description: 'test' } as any
    const applied = builder.route(route)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      route: { ...def.route, ...route },
    })
  })

  it('.input', () => {
    const applied = builder.input(generalSchema)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      inputSchema: generalSchema,
      inputValidationIndex: 12,
    })
  })

  it('.output', () => {
    const applied = builder.output(generalSchema)

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      outputSchema: generalSchema,
      outputValidationIndex: 23,
    })
  })

  it('.handler', () => {
    const handler = vi.fn()
    const applied = builder.handler(handler)

    expect(applied).instanceOf(DecoratedProcedure)
    expect(applied['~orpc']).toEqual({
      ...def,
      handler,
    })
  })

  it('.prefix', () => {
    const applied = builder.prefix('/test')

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      prefix: '/adapt/test',
    })
  })

  it('.tag', () => {
    const applied = builder.tag('test')

    expect(applied).instanceOf(Builder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      tags: ['adapt', 'test'],
    })
  })

  it('.router', () => {
    const applied = builder.router(router as any)

    expect(applied).toBe(enhanceRouterSpy.mock.results[0]?.value)
    expect(enhanceRouterSpy).toBeCalledTimes(1)
    expect(enhanceRouterSpy).toBeCalledWith(router, def)
  })

  it('.lazy', () => {
    const applied = builder.lazy(() => Promise.resolve({ default: router as any }))

    expect(applied).toBe(enhanceRouterSpy.mock.results[0]?.value)
    expect(enhanceRouterSpy).toBeCalledTimes(1)
    expect(enhanceRouterSpy).toBeCalledWith(expect.any(Object), def)
    expect(unlazy(enhanceRouterSpy.mock.calls[0]![0])).resolves.toEqual({ default: router })
  })
})
