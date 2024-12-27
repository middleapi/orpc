import { z } from 'zod'
import { Builder } from './builder'
import { createChainableImplementer } from './implementer-chainable'
import { isProcedure } from './procedure'
import { ProcedureBuilder } from './procedure-builder'
import { RouterBuilder } from './router-builder'

vi.mock('./router-builder', () => ({
  RouterBuilder: vi.fn(() => ({
    router: vi.fn(() => ({ mocked: true })),
    lazy: vi.fn(() => ({ mocked: true })),
  })),
}))

vi.mock('./implementer-chainable', () => ({
  createChainableImplementer: vi.fn(() => ({ mocked: true })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })

const mid = vi.fn()
const builder = new Builder({
  middlewares: [mid],
})

describe('self chainable', () => {
  it('define context', () => {
    const applied = builder.context()

    expect(applied).not.toBe(builder)
    expect(applied).toBeInstanceOf(Builder)

    expect(applied['~orpc'].middlewares).toEqual(undefined)
  })

  it('use middleware', () => {
    const builder = new Builder({
    })

    const mid1 = vi.fn()
    const mid2 = vi.fn()
    const mid3 = vi.fn()

    const applied = builder.use(mid1).use(mid2).use(mid3)
    expect(applied).not.toBe(builder)
    expect(applied).toBeInstanceOf(Builder)
    expect(applied['~orpc'].middlewares).toEqual([mid1, mid2, mid3])
  })
})

describe('create middleware', () => {
  it('works', () => {
    const fn = vi.fn()
    const mid = builder.middleware(fn) as any

    fn.mockReturnValueOnce('__mocked__')
    expect(mid).toBeTypeOf('function')
    expect(mid(1, 2, 3)).toBe('__mocked__')

    expect(fn).toBeCalledTimes(1)
    expect(fn).toBeCalledWith(1, 2, 3)
  })
})

describe('to ProcedureBuilder', () => {
  it('route', () => {
    const route = { path: '/test', method: 'GET', description: '124', tags: ['hi ho'] } as const
    const result = builder.route(route)

    expect(result).instanceOf(ProcedureBuilder)
    expect(result['~orpc'].middlewares).toEqual([mid])
    expect(result['~orpc'].contract['~orpc'].route).toBe(route)
  })

  it('input', () => {
    const example = { val: '123' }
    const result = builder.input(schema, example)

    expect(result).instanceOf(ProcedureBuilder)
    expect(result['~orpc'].middlewares).toEqual([mid])
    expect(result['~orpc'].contract['~orpc'].InputSchema).toBe(schema)
    expect(result['~orpc'].contract['~orpc'].inputExample).toBe(example)
  })

  it('output', () => {
    const example = { val: 123 }
    const result = builder.output(schema, example)

    expect(result).instanceOf(ProcedureBuilder)
    expect(result['~orpc'].middlewares).toEqual([mid])
    expect(result['~orpc'].contract['~orpc'].OutputSchema).toBe(schema)
    expect(result['~orpc'].contract['~orpc'].outputExample).toBe(example)
  })
})

describe('to DecoratedProcedure', () => {
  it('handler', () => {
    const fn = vi.fn()
    const result = builder.handler(fn)

    expect(result).toSatisfy(isProcedure)
    expect(result['~orpc'].middlewares).toEqual([mid])
    expect(result['~orpc'].handler).toBe(fn)
  })
})

describe('to RouterBuilder', () => {
  it('prefix', () => {
    vi.mocked(RouterBuilder).mockReturnValueOnce({ mocked: true } as any)
    expect(builder.prefix('/test')).toEqual({ mocked: true })

    expect(RouterBuilder).toBeCalledTimes(1)
    expect(RouterBuilder).toBeCalledWith(expect.objectContaining({
      middlewares: [mid],
      prefix: '/test',
    }))
  })

  it('tag', () => {
    vi.mocked(RouterBuilder).mockReturnValueOnce({ mocked: true } as any)
    expect(builder.tag('tag1', 'tag2')).toEqual({ mocked: true })

    expect(RouterBuilder).toBeCalledTimes(1)
    expect(RouterBuilder).toBeCalledWith(expect.objectContaining({
      middlewares: [mid],
      tags: ['tag1', 'tag2'],
    }))
  })
})

it('to AdaptedRouter', () => {
  const ping = vi.fn() as any
  const router = {
    ping,
    nested: {
      ping,
    },
  }

  expect(builder.router(router)).toEqual({ mocked: true })

  expect(RouterBuilder).toBeCalledTimes(1)
  expect(RouterBuilder).toBeCalledWith(expect.objectContaining({
    middlewares: [mid],
  }))

  const routerBuilder = vi.mocked(RouterBuilder).mock.results[0]?.value
  expect(vi.mocked(routerBuilder.router)).toBeCalledTimes(1)
  expect(vi.mocked(routerBuilder.router)).toBeCalledWith(router)
})

it('to DecoratedLazy', () => {
  const loader = vi.fn() as any

  expect(builder.lazy(loader)).toEqual({ mocked: true })
  expect(RouterBuilder).toBeCalledTimes(1)
  expect(RouterBuilder).toBeCalledWith(expect.objectContaining({
    middlewares: [mid],
  }))

  const routerBuilder = vi.mocked(RouterBuilder).mock.results[0]?.value
  expect(vi.mocked(routerBuilder.lazy)).toBeCalledTimes(1)
  expect(vi.mocked(routerBuilder.lazy)).toBeCalledWith(loader)
})

it('to ChainableImplementer', () => {
  const contract = vi.fn() as any

  expect(builder.contract(contract)).toEqual({ mocked: true })
  expect(createChainableImplementer).toBeCalledTimes(1)
  expect(createChainableImplementer).toBeCalledWith(contract, [mid])
})
