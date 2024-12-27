import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { isLazy, lazy, unlazy } from './lazy'
import { Procedure } from './procedure'
import { getRouterChild } from './router'

describe('getRouterChild', () => {
  const schema = z.object({ val: z.string().transform(val => Number(val)) })

  const ping = new Procedure({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    handler: vi.fn(() => ({ val: '123' })),
  })
  const pong = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: vi.fn(() => ('output')),
  })

  it('with procedure as router', () => {
    expect(getRouterChild(ping)).toBe(ping)
    expect(getRouterChild(ping, '~orpc')).toBe(undefined)
    expect(getRouterChild(ping, '~type')).toBe(undefined)
  })

  it('with router', () => {
    const router = {
      ping,
      pong,
      nested: {
        ping,
        pong,
      },
    }

    expect(getRouterChild(router, 'ping')).toBe(ping)
    expect(getRouterChild(router, 'pong')).toBe(pong)
    expect(getRouterChild(router, 'nested')).toBe(router.nested)
    expect(getRouterChild(router, 'nested', 'ping')).toBe(ping)
    expect(getRouterChild(router, 'nested', 'pong')).toBe(pong)
    expect(getRouterChild(router, 'nested', '~orpc')).toBe(undefined)
    expect(getRouterChild(router, 'nested', 'ping', '~orpc')).toBe(undefined)
    expect(getRouterChild(router, 'nested', 'pue', '~orpc', 'peng', 'pue')).toBe(undefined)
  })

  it('with lazy router', async () => {
    const lazyPing = lazy(() => Promise.resolve({ default: ping }))
    const lazyPong = lazy(() => Promise.resolve({ default: pong }))

    const lazyNested = lazy(() => Promise.resolve({
      default: {
        ping,
        pong: lazyPong,
        nested2: lazy(() => Promise.resolve({
          default: {
            ping,
            pong: lazyPong,
          },
        })),
      },
    }))

    const router = {
      ping: lazyPing,
      pong,
      nested: lazyNested,
    }

    expect(await unlazy(getRouterChild(router, 'ping'))).toEqual({ default: ping })
    expect(getRouterChild(router, 'pong')).toBe(pong)

    expect(getRouterChild(router, 'nested')).toSatisfy(isLazy)
    expect(getRouterChild(router, 'nested', 'ping')).toSatisfy(isLazy)
    expect(getRouterChild(router, 'nested', 'pong')).toSatisfy(isLazy)

    expect(getRouterChild(router, 'nested')).toBe(lazyNested)
    expect(await unlazy(getRouterChild(router, 'nested', 'ping'))).toEqual({ default: ping })
    expect(await unlazy(getRouterChild(router, 'nested', 'pong'))).toEqual({ default: pong })

    expect(getRouterChild(router, 'nested', '~orpc')).toSatisfy(isLazy)
    expect(await unlazy(getRouterChild(router, 'nested', '~orpc'))).toEqual({ default: undefined })

    expect(await unlazy(getRouterChild(router, 'nested', 'nested2', 'pong'))).toEqual({ default: pong })
    expect(await unlazy(getRouterChild(router, 'nested', 'nested2', 'peo', 'pue', 'cu', 'la'))).toEqual({ default: undefined })
  })

  it('support Lazy<undefined>', async () => {
    const lazied = lazy(() => Promise.resolve({ default: undefined }))

    expect(await unlazy(getRouterChild(lazied, 'ping'))).toEqual({ default: undefined })
    expect(await unlazy(getRouterChild(lazied, 'ping', '~orpc'))).toEqual({ default: undefined })
  })
})
