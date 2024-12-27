import { oc } from '@orpc/contract'
import { z } from 'zod'
import { getRouterContract } from './hidden'
import { Procedure } from './procedure'
import { RouterBuilder } from './router-builder'
import { RouterImplementer } from './router-implementer'

vi.mock('./router-builder', () => ({
  RouterBuilder: vi.fn(() => ({
    router: vi.fn(() => ({ mocked: true })),
    lazy: vi.fn(() => ({ mocked: true })),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const schema = z.object({ val: z.string().transform(val => Number(val)) })

const ping = oc.input(schema).output(schema)
const pong = oc.route({ method: 'GET', path: '/ping' })

const contract = oc.router({
  ping,
  pong,
  nested: {
    ping,
    pong,
  },
})

const pingImpl = new Procedure({
  contract: ping,
  handler: vi.fn(),
})

const pongImpl = new Procedure({
  contract: pong,
  handler: vi.fn(),
})

const router = {
  ping: pingImpl,
  pong: pongImpl,
  nested: {
    ping: pingImpl,
    pong: pongImpl,
  },
}

const mid = vi.fn()
const implementer = new RouterImplementer({
  contract,
  middlewares: [mid],
})

describe('self chainable', () => {
  it('use middleware', () => {
    const mid1 = vi.fn()
    const mid2 = vi.fn()
    const mid3 = vi.fn()

    const implementer = new RouterImplementer({
      contract,
    })

    const applied1 = implementer.use(mid1)
    expect(applied1).not.toBe(implementer)
    expect(applied1).toBeInstanceOf(RouterImplementer)
    expect(applied1['~orpc'].middlewares).toEqual([mid1])

    const applied2 = applied1.use(mid2).use(mid3)
    expect(applied2['~orpc'].middlewares).toEqual([mid1, mid2, mid3])
  })
})

describe('to AdaptedRouter', () => {
  it('works', () => {
    expect(implementer.router(router)).toEqual({ mocked: true })

    expect(RouterBuilder).toBeCalledTimes(1)
    expect(RouterBuilder).toBeCalledWith(expect.objectContaining({
      middlewares: [mid],
    }))

    const builder = vi.mocked(RouterBuilder).mock.results[0]?.value
    expect(vi.mocked(builder.router)).toBeCalledTimes(1)
    expect(vi.mocked(builder.router)).toBeCalledWith(router)
  })

  it('attach contract', () => {
    const adapted = implementer.router(router) as any
    expect(getRouterContract(adapted)).toBe(contract)
  })
})

describe('to AdaptedLazy', () => {
  it('works', () => {
    const loader = () => Promise.resolve({ default: router })
    expect(implementer.lazy(loader)).toEqual({ mocked: true })

    expect(RouterBuilder).toBeCalledTimes(1)
    expect(RouterBuilder).toBeCalledWith(expect.objectContaining({
      middlewares: [mid],
    }))

    const builder = vi.mocked(RouterBuilder).mock.results[0]?.value
    expect(vi.mocked(builder.lazy)).toBeCalledTimes(1)
    expect(vi.mocked(builder.lazy)).toBeCalledWith(loader)
  })

  it('attach contract', () => {
    const adapted = implementer.lazy(() => Promise.resolve({ default: router })) as any
    expect(getRouterContract(adapted)).toBe(contract)
  })
})
