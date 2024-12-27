import { os } from '@orpc/server'
import { LinearRouter } from 'hono/router/linear-router'
import { PatternRouter } from 'hono/router/pattern-router'
import { TrieRouter } from 'hono/router/trie-router'
import { OpenAPIProcedureMatcher } from './openapi-procedure-matcher'

const hono = [
  ['LinearRouter', new LinearRouter<any>()],
  // ['RegExpRouter', new RegExpRouter<any>()],
  ['TrieRouter', new TrieRouter<any>()],
  ['PatternRouter', new PatternRouter<any>()],
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(hono)('openAPIProcedureMatcher: %s', (_, hono) => {
  const ping = os.route({ path: '/ping', method: 'GET' }).handler(() => 'pong')
  const pong = os.route({ path: '/pong/{name}' }).handler(() => 'pong')

  const pingLazyLoader = vi.fn(() => Promise.resolve({ default: ping }))
  const pongLazyLoader = vi.fn(() => Promise.resolve({ default: pong }))

  const lazyRouterLoader = vi.fn(() => Promise.resolve({ default: { ping, pong: os.lazy(pongLazyLoader) } }))

  const router = os.router({
    ping: os.lazy(pingLazyLoader),
    pong,
    nested: os.prefix('/nested').lazy(lazyRouterLoader),
  })

  const matcher = new OpenAPIProcedureMatcher(hono, router)

  it('lazy load nested router has prefix', async () => {
    const r1 = await matcher.match('GET', '/not-found')
    expect(r1).toBeUndefined()

    expect(pingLazyLoader).toBeCalledTimes(1)
    expect(pongLazyLoader).toBeCalledTimes(0)
    expect(lazyRouterLoader).toBeCalledTimes(0)

    vi.clearAllMocks()
    const r2 = await matcher.match('GET', '/ping')
    expect(r2?.path).toEqual(['ping'])
    expect(r2?.procedure['~orpc'].handler).toBe(ping['~orpc'].handler)

    expect(pingLazyLoader).toBeCalledTimes(1)
    expect(pongLazyLoader).toBeCalledTimes(0)
    expect(lazyRouterLoader).toBeCalledTimes(0)

    vi.clearAllMocks()
    const r3 = await matcher.match('GET', '/nested')
    expect(r3).toBeUndefined()

    expect(pingLazyLoader).toBeCalledTimes(0)
    expect(pongLazyLoader).toBeCalledTimes(1)
    expect(lazyRouterLoader).toBeCalledTimes(1)

    vi.clearAllMocks()
    const r4 = await matcher.match('GET', '/nested/ping')
    expect(r4?.path).toEqual(['nested', 'ping'])
    expect(r4?.procedure['~orpc'].handler).toBe(ping['~orpc'].handler)

    expect(pingLazyLoader).toBeCalledTimes(0)
    expect(pongLazyLoader).toBeCalledTimes(0)
    expect(lazyRouterLoader).toBeCalledTimes(1)
  })

  it('match and params', async () => {
    const r1 = await matcher.match('POST', '/pong/unnoq')

    expect(r1?.path).toEqual(['pong'])
    expect(r1?.params).toEqual({ name: 'unnoq' })
    expect(r1?.procedure['~orpc'].handler).toBe(pong['~orpc'].handler)
  })

  it('not found', async () => {
    const r1 = await matcher.match('GET', '/not-found')
    expect(r1).toBeUndefined()
  })
})
