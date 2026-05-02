import { baseErrorMap, baseMeta, baseRoute, generalSchema, inputSchema, outputSchema, ping, pong } from '../tests/shared'
import { ContractBuilder } from './builder'
import { mergeErrorMap } from './error'
import { isContractProcedure } from './procedure'
import * as RouterUtilsModule from './router-utils'

const enhanceContractRouterSpy = vi.spyOn(RouterUtilsModule, 'enhanceContractRouter')

const def = {
  errorMap: baseErrorMap,
  outputSchema,
  inputSchema,
  route: baseRoute,
  meta: baseMeta,
  prefix: '/adapt' as const,
  tags: ['adapt'],
}

const builder = new ContractBuilder(def)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('contractBuilder', () => {
  it('is a contract procedure', () => {
    expect(builder).toSatisfy(isContractProcedure)
  })

  it('.$meta', () => {
    const meta = { dev: true, log: true }
    const applied = builder.$meta(meta)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      meta,
    })
  })

  it('.$route', () => {
    const route = { path: '/api', method: 'GET' } as const

    const applied = builder.$route(route)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      route,
    })
  })

  it('.$input', () => {
    const applied = builder.$input(generalSchema)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      inputSchema: generalSchema,
    })
  })

  it('.errors', () => {
    const errors = { BAD_GATEWAY: { data: outputSchema }, OVERRIDE: { message: 'override' } } as const

    const applied = builder.errors(errors)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      errorMap: mergeErrorMap(def.errorMap, errors),
    })
  })

  it('.meta', () => {
    const meta = { dev: true, log: true }
    const applied = builder.meta(meta)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      meta: { ...def.meta, ...meta },
    })
  })

  it('.route', () => {
    const route = { method: 'GET', path: '/path' } as const
    const applied = builder.route(route)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      route: { ...def.route, ...route },
    })
  })

  it('.input', () => {
    const applied = builder.input(generalSchema)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      inputSchema: generalSchema,
    })
  })

  it('.output', () => {
    const applied = builder.output(generalSchema)
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      outputSchema: generalSchema,
    })
  })

  it('.prefix', () => {
    const applied = builder.prefix('/api')
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      prefix: '/adapt/api',
    })
  })

  it('.tag', () => {
    const applied = builder.tag('tag1', 'tag2')
    expect(applied).toBeInstanceOf(ContractBuilder)
    expect(applied).not.toBe(builder)
    expect(applied['~orpc']).toEqual({
      ...def,
      tags: ['adapt', 'tag1', 'tag2'],
    })
  })

  it('.router', () => {
    const router = { ping, pong }
    const applied = builder.router(router)
    expect(applied).toBe(enhanceContractRouterSpy.mock.results[0]?.value)
    expect(enhanceContractRouterSpy).toHaveBeenCalledOnce()
    expect(enhanceContractRouterSpy).toHaveBeenCalledWith(router, def)
  })
})
