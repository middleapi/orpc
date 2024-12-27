import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { getLazyRouterPrefix } from './hidden'
import { isLazy, lazy, unlazy } from './lazy'
import { isProcedure, Procedure } from './procedure'
import { RouterBuilder } from './router-builder'

const mid1 = vi.fn()
const mid2 = vi.fn()

const builder = new RouterBuilder<{ auth: boolean }, { db: string }>({
  middlewares: [mid1, mid2],
  prefix: '/prefix',
  tags: ['tag1', 'tag2'],
})

it('prevent dynamic params on prefix', () => {
  expect(() => builder.prefix('/{id}')).toThrowError()
  expect(() => new RouterBuilder({ prefix: '/{id}' })).toThrowError()
})

describe('self chainable', () => {
  it('prefix', () => {
    const prefixed = builder.prefix('/test')
    expect(prefixed).not.toBe(builder)
    expect(prefixed).toBeInstanceOf(RouterBuilder)
    expect(prefixed['~orpc'].prefix).toBe('/prefix/test')
  })

  it('prefix --- still work without pre prefix', () => {
    const builder = new RouterBuilder({})

    const prefixed = builder.prefix('/test')
    expect(prefixed).not.toBe(builder)
    expect(prefixed).toBeInstanceOf(RouterBuilder)
    expect(prefixed['~orpc'].prefix).toBe('/test')
  })

  it('tag', () => {
    const tagged = builder.tag('test1', 'test2')
    expect(tagged).not.toBe(builder)
    expect(tagged).toBeInstanceOf(RouterBuilder)
    expect(tagged['~orpc'].tags).toEqual(['tag1', 'tag2', 'test1', 'test2'])
  })

  it('tag --- still work without pre tag', () => {
    const builder = new RouterBuilder({})

    const tagged = builder.tag('test1', 'test2')
    expect(tagged).not.toBe(builder)
    expect(tagged).toBeInstanceOf(RouterBuilder)
    expect(tagged['~orpc'].tags).toEqual(['test1', 'test2'])
  })

  it('use middleware', () => {
    const mid3 = vi.fn()
    const mid4 = vi.fn()

    const applied = builder.use(mid3).use(mid4)
    expect(applied).not.toBe(builder)
    expect(applied).toBeInstanceOf(RouterBuilder)
    expect(applied['~orpc'].middlewares).toEqual([mid1, mid2, mid3, mid4])
  })

  it('use middleware --- still work without pre middleware', () => {
    const builder = new RouterBuilder({})

    const applied = builder.use(mid1).use(mid2)
    expect(applied).not.toBe(builder)
    expect(applied).toBeInstanceOf(RouterBuilder)
    expect(applied['~orpc'].middlewares).toEqual([mid1, mid2])
  })
})

describe('adapt router', () => {
  const pMid1 = vi.fn()
  const pMid2 = vi.fn()

  const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })
  const ping = new Procedure({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: undefined,
      route: {
        tags: ['tag3', 'tag4'],
      },
    }),
    handler: vi.fn(),
    middlewares: [mid1, pMid1, pMid2],
  })
  const pong = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: schema,
      route: {
        method: 'GET',
        path: '/pong',
        description: 'desc',
      },
    }),
    handler: vi.fn(),
  })

  const router = {
    ping,
    pong,
    nested: {
      ping,
      pong,
    },
  }

  const routerWithLazy = {
    ping: lazy(() => Promise.resolve({ default: ping })),
    pong,
    nested: lazy(() => Promise.resolve({ default: {
      ping,
      pong: lazy(() => Promise.resolve({ default: pong })),
    } })),
  }

  it('router without lazy', () => {
    const adapted = builder.router(router)

    expect(adapted.ping).toSatisfy(isProcedure)
    expect(typeof adapted.ping).toBe('function')
    expect(adapted.ping['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect(adapted.ping['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect(adapted.ping['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect(adapted.ping['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect(adapted.ping['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    expect(adapted.pong).toSatisfy(isProcedure)
    expect(typeof adapted.pong).toBe('function')
    expect(adapted.pong['~orpc'].handler).toBe(pong['~orpc'].handler)
    expect(adapted.pong['~orpc'].middlewares).toEqual([mid1, mid2])
    expect(adapted.pong['~orpc'].contract['~orpc'].route?.path).toBe('/prefix/pong')
    expect(adapted.pong['~orpc'].contract['~orpc'].route?.method).toBe('GET')
    expect(adapted.pong['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2'])

    expect(adapted.nested.ping).toSatisfy(isProcedure)
    expect(typeof adapted.nested.ping).toBe('function')
    expect(adapted.nested.ping['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect(adapted.nested.ping['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect(adapted.nested.ping['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect(adapted.nested.ping['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect(adapted.nested.ping['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    expect(adapted.nested.pong).toSatisfy(isProcedure)
    expect(typeof adapted.nested.pong).toBe('function')
    expect(adapted.nested.pong['~orpc'].handler).toBe(pong['~orpc'].handler)
    expect(adapted.nested.pong['~orpc'].middlewares).toEqual([mid1, mid2])
    expect(adapted.nested.pong['~orpc'].contract['~orpc'].route?.path).toBe('/prefix/pong')
    expect(adapted.nested.pong['~orpc'].contract['~orpc'].route?.method).toBe('GET')
    expect(adapted.nested.pong['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2'])
  })

  it('router with lazy', async () => {
    const adapted = builder.router(routerWithLazy) as any

    expect(getLazyRouterPrefix(adapted.ping)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.pong)).toBe(undefined)
    expect(getLazyRouterPrefix(adapted.nested)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.nested.ping)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.nested.pong)).toBe('/prefix')

    expect(adapted.ping).toSatisfy(isLazy)
    expect(typeof adapted.ping).toBe('function')
    expect((await unlazy(adapted.ping) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect((await unlazy(adapted.ping) as any).default['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    expect(adapted.pong).toSatisfy(isProcedure)
    expect(typeof adapted.pong).toBe('function')
    expect(adapted.pong['~orpc'].handler).toBe(pong['~orpc'].handler)
    expect(adapted.pong['~orpc'].middlewares).toEqual([mid1, mid2])
    expect(adapted.pong['~orpc'].contract['~orpc'].route?.path).toBe('/prefix/pong')
    expect(adapted.pong['~orpc'].contract['~orpc'].route?.method).toBe('GET')
    expect(adapted.pong['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2'])

    expect(adapted.nested.ping).toSatisfy(isLazy)
    expect(typeof adapted.nested.ping).toBe('function')
    expect((await unlazy(adapted.nested.ping) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    expect(adapted.nested.pong).toSatisfy(isLazy)
    expect(typeof adapted.nested.pong).toBe('function')
    expect((await unlazy(adapted.nested.pong) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].handler).toBe(pong['~orpc'].handler)
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].middlewares).toEqual([mid1, mid2])
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].contract['~orpc'].route?.path).toBe('/prefix/pong')
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].contract['~orpc'].route?.method).toBe('GET')
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2'])
  })

  it('router lazy with nested lazy', async () => {
    const adapted = builder.lazy(() => Promise.resolve({ default: routerWithLazy })) as any

    expect(getLazyRouterPrefix(adapted.ping)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.pong)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.nested)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.nested.ping)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted.nested.pong)).toBe('/prefix')

    expect(adapted.ping).toSatisfy(isLazy)
    expect(typeof adapted.ping).toBe('function')
    expect((await unlazy(adapted.ping) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect((await unlazy(adapted.ping) as any).default['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect((await unlazy(adapted.ping) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    expect(adapted.pong).toSatisfy(isLazy)
    expect(typeof adapted.pong).toBe('function')
    expect((await unlazy(adapted.pong) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.pong) as any).default['~orpc'].handler).toBe(pong['~orpc'].handler)
    expect((await unlazy(adapted.pong) as any).default['~orpc'].middlewares).toEqual([mid1, mid2])
    expect((await unlazy(adapted.pong) as any).default['~orpc'].contract['~orpc'].route?.path).toBe('/prefix/pong')
    expect((await unlazy(adapted.pong) as any).default['~orpc'].contract['~orpc'].route?.method).toBe('GET')
    expect((await unlazy(adapted.pong) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2'])

    expect(adapted.nested.ping).toSatisfy(isLazy)
    expect(typeof adapted.nested.ping).toBe('function')
    expect((await unlazy(adapted.nested.ping) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect((await unlazy(adapted.nested.ping) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    expect(adapted.nested.pong).toSatisfy(isLazy)
    expect(typeof adapted.nested.pong).toBe('function')
    expect((await unlazy(adapted.nested.pong) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].handler).toBe(pong['~orpc'].handler)
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].middlewares).toEqual([mid1, mid2])
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].contract['~orpc'].route?.path).toBe('/prefix/pong')
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].contract['~orpc'].route?.method).toBe('GET')
    expect((await unlazy(adapted.nested.pong) as any).default['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2'])
  })

  it('support procedure as a router', async () => {
    const adapted = builder.router(ping)

    expect(adapted).toSatisfy(isProcedure)
    expect(typeof adapted).toBe('function')
    expect(adapted['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect(adapted['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect(adapted['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect(adapted['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
    expect(adapted['~orpc'].contract['~orpc'].route?.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])

    const adaptedLazy = builder.router(lazy(() => Promise.resolve({ default: ping })))

    expect(adaptedLazy).toSatisfy(isLazy)
    expect(typeof adaptedLazy).toBe('function')
    expect((await unlazy(adaptedLazy) as any).default).toSatisfy(isProcedure)
    expect((await unlazy(adaptedLazy) as any).default['~orpc'].handler).toBe(ping['~orpc'].handler)
    expect((await unlazy(adaptedLazy) as any).default['~orpc'].middlewares).toEqual([mid1, mid2, pMid1, pMid2])
    expect((await unlazy(adaptedLazy) as any).default['~orpc'].contract['~orpc'].route?.path).toBe(undefined)
    expect((await unlazy(adaptedLazy) as any).default['~orpc'].contract['~orpc'].route?.method).toBe(undefined)
  })

  it('can concat LAZY_ROUTER_PREFIX_SYMBOL', () => {
    const adapted = builder.prefix('/hi').router(builder.router(routerWithLazy)) as any
    expect(getLazyRouterPrefix(adapted.ping)).toBe('/prefix/hi/prefix')
  })

  it('works with LAZY_ROUTER_PREFIX_SYMBOL when prefix is not set', () => {
    const builderWithoutPrefix = new RouterBuilder({})
    const adapted = builderWithoutPrefix.router(routerWithLazy) as any
    expect(getLazyRouterPrefix(adapted.ping)).toBe(undefined)
    expect(getLazyRouterPrefix(adapted.pong)).toBe(undefined)

    const adapted2 = builderWithoutPrefix.router(builder.router(routerWithLazy) as any) as any
    expect(getLazyRouterPrefix(adapted2.ping)).toBe('/prefix')
    expect(getLazyRouterPrefix(adapted2.pong)).toBe(undefined)
  })

  it('getLazyRouterPrefix works', () => {
    expect(getLazyRouterPrefix({})).toBe(undefined)
    expect(getLazyRouterPrefix(builder.router(routerWithLazy).ping)).toBe('/prefix')
    expect(getLazyRouterPrefix(builder.router(routerWithLazy).pong)).toBe(undefined)
  })

  it('deepSetLazyRouterPrefix not recursive on Symbol', () => {
    const adapted = builder.router(routerWithLazy) as any

    expect(adapted.nested[Symbol('anything')]).toBe(undefined)
  })
})
