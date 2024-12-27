import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { isProcedure, Procedure } from './procedure'
import { decorateProcedure } from './procedure-decorated'

beforeEach(() => {
  vi.clearAllMocks()
})

const handler = vi.fn(() => ({ val: '123' }))
const mid = vi.fn((_, __, meta) => meta.next({}))

const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })
const procedure = new Procedure<{ auth: boolean }, { db: string }, typeof schema, typeof schema, { val: string }>({
  contract: new ContractProcedure({
    InputSchema: schema,
    OutputSchema: schema,
    route: { path: '/test', method: 'GET', deprecated: true, description: 'des', summary: 'sum', tags: ['hi'] },
    inputExample: { val: 123 },
    outputExample: { val: 456 },
  }),
  handler,
  middlewares: [mid],
})

const decorated = decorateProcedure(procedure)

describe('self chainable', () => {
  it('prefix', () => {
    const prefixed = decorated.prefix('/test')

    expect(prefixed).not.toBe(decorated)

    expect(prefixed).toSatisfy(isProcedure)
    expect(prefixed['~orpc'].contract['~orpc'].route?.path).toBe('/test/test')
  })

  it('route', () => {
    const route = { path: '/test', method: 'GET', tags: ['hiu'] } as const
    const routed = decorated.route(route)

    expect(routed).not.toBe(decorated)
    expect(routed).toSatisfy(isProcedure)
    expect(routed['~orpc'].contract['~orpc'].route).toBe(route)
  })

  it('use middleware', () => {
    const extraMid = vi.fn()

    const applied = decorated.use(extraMid)

    expect(applied).not.toBe(decorated)
    expect(applied).toSatisfy(isProcedure)
    expect(applied['~orpc'].middlewares).toEqual([mid, extraMid])
  })

  it('use middleware with map input', () => {
    const extraMid = vi.fn()
    const map = vi.fn()

    const applied = decorated.use(extraMid, map)
    expect(applied).not.toBe(decorated)
    expect(applied).toSatisfy(isProcedure)
    expect(applied['~orpc'].middlewares).toEqual([mid, expect.any(Function)])

    extraMid.mockReturnValueOnce('__extra__')
    map.mockReturnValueOnce('__map__')

    expect((applied as any)['~orpc'].middlewares[1]('input')).toBe('__extra__')

    expect(map).toBeCalledTimes(1)
    expect(map).toBeCalledWith('input')

    expect(extraMid).toBeCalledTimes(1)
    expect(extraMid).toBeCalledWith('__map__')
  })

  it('unshiftTag', () => {
    const tagged = decorated.unshiftTag('test', 'test2', 'test3')
    expect(tagged).not.toBe(decorated)
    expect(tagged).toSatisfy(isProcedure)
    expect(tagged['~orpc'].contract['~orpc'].route?.tags).toEqual(['test', 'test2', 'test3', 'hi'])
  })

  it('unshiftMiddleware', () => {
    const mid1 = vi.fn()
    const mid2 = vi.fn()

    const applied = decorated.unshiftMiddleware(mid1, mid2)
    expect(applied).not.toBe(decorated)
    expect(applied).toSatisfy(isProcedure)
    expect(applied['~orpc'].middlewares).toEqual([mid1, mid2, mid])
  })

  describe('unshiftMiddleware --- prevent duplicate', () => {
    const mid1 = vi.fn()
    const mid2 = vi.fn()
    const mid3 = vi.fn()
    const mid4 = vi.fn()
    const mid5 = vi.fn()

    it('no duplicate', () => {
      expect(
        decorated.unshiftMiddleware(mid1, mid2)['~orpc'].middlewares,
      ).toEqual([mid1, mid2, mid])
    })

    it('case 1', () => {
      expect(
        decorated.unshiftMiddleware(mid1, mid2).unshiftMiddleware(mid1, mid3)['~orpc'].middlewares,
      ).toEqual([mid1, mid3, mid2, mid])
    })

    it('case 2', () => {
      expect(
        decorated.unshiftMiddleware(mid1, mid2, mid3, mid4).unshiftMiddleware(mid1, mid4, mid2, mid3)['~orpc'].middlewares,
      ).toEqual([mid1, mid4, mid2, mid3, mid4, mid])
    })

    it('case 3', () => {
      expect(
        decorated.unshiftMiddleware(mid1, mid5, mid2, mid3, mid4).unshiftMiddleware(mid1, mid4, mid2, mid3)['~orpc'].middlewares,
      ).toEqual([mid1, mid4, mid2, mid3, mid5, mid2, mid3, mid4, mid])
    })

    it('case 4', () => {
      expect(
        decorated
          .unshiftMiddleware(mid2, mid2)
          .unshiftMiddleware(mid1, mid2)['~orpc'].middlewares,
      ).toEqual([mid1, mid2, mid2, mid])
    })

    it('case 5', () => {
      expect(
        decorated
          .unshiftMiddleware(mid2, mid2)
          .unshiftMiddleware(mid1, mid2, mid2)['~orpc'].middlewares,
      ).toEqual([mid1, mid2, mid2, mid])
    })
  })
})

it('can use middleware when has no middleware', () => {
  const decorated = decorateProcedure(new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: () => { },
  }))

  const mid = vi.fn()
  const applied = decorated.use(mid)

  expect(applied).not.toBe(decorated)
  expect(applied).toSatisfy(isProcedure)
  expect(applied['~orpc'].middlewares).toEqual([mid])
})

it('can unshift middleware when has no middleware', () => {
  const decorated = decorateProcedure(new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: () => { },
  }))

  const mid1 = vi.fn()
  const mid2 = vi.fn()
  const applied = decorated.unshiftMiddleware(mid1, mid2)

  expect(applied).not.toBe(decorated)
  expect(applied).toSatisfy(isProcedure)
  expect(applied['~orpc'].middlewares).toEqual([mid1, mid2])
})
