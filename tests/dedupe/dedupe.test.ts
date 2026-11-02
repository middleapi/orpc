import { oc } from '@orpc/contract'
import { getOpenAPIMeta, openapi } from '@orpc/openapi'
import { call, implement, os } from '@orpc/server'
import { z } from 'zod'

describe('auto dedupe', () => {
  it('builder: runs a shared middleware once and applies shared meta plugins once', async () => {
    const auth = vi.fn(({ next }) => next())

    const base = os
      .meta(openapi({ tags: ['users'], prefix: '/api' }))
      .use(auth)

    const router = base.router({
      ping: base.meta(openapi({ path: '/ping' })).handler(() => 'pong'),
      nested: base.router({
        ping: base.handler(() => 'pong'),
      }),
      lazy: base.lazy(async () => ({ default: { ping: base.handler(() => 'pong') } })),
    })

    expect(getOpenAPIMeta(router.ping)).toEqual(expect.objectContaining({ tags: ['users'], prefix: '/api', path: '/ping' }))
    expect(getOpenAPIMeta(router.nested.ping)).toEqual(expect.objectContaining({ tags: ['users'], prefix: '/api' }))
    expect(getOpenAPIMeta(router.lazy)).toEqual(expect.objectContaining({ tags: ['users'], prefix: '/api' }))

    await expect(call(router.ping, undefined)).resolves.toBe('pong')
    expect(auth).toHaveBeenCalledTimes(1)

    auth.mockClear()
    await expect(call(router.nested.ping, undefined)).resolves.toBe('pong')
    expect(auth).toHaveBeenCalledTimes(1)
  })

  it('builder: applies shared leading meta plugins once when router and procedure builders diverge', () => {
    const base = os.meta(openapi({ prefix: '/api' }))

    const router = base.meta(openapi({ tags: ['users'] })).router({
      ping: base.meta(openapi({ path: '/ping' })).handler(() => 'pong'),
    })

    expect(getOpenAPIMeta(router.ping)).toEqual(expect.objectContaining({ tags: ['users'], prefix: '/api', path: '/ping' }))
  })

  it('builder: still runs middleware applied in a different position', async () => {
    const auth = vi.fn(({ next }) => next())
    const other = vi.fn(({ next }) => next())

    const router = os.use(auth).router({
      ping: os.use(other).use(auth).handler(() => 'pong'),
    })

    await call(router.ping, undefined)
    expect(auth).toHaveBeenCalledTimes(2)
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('builder: still runs router-level middleware when the procedure applies it after input validation', async () => {
    const auth = vi.fn(({ next }) => next())

    const router = os.use(auth).router({
      ping: os.input(z.string()).use(auth).handler(({ input }) => input),
    })

    // router-level auth must still run before input validation
    await expect(call(router.ping, 123 as any)).rejects.toThrow()
    expect(auth).toHaveBeenCalledTimes(1)

    auth.mockClear()
    await call(router.ping, 'pong')
    expect(auth).toHaveBeenCalledTimes(2)
  })

  it('builder: dedupeLeadingMiddlewares: false disables middleware dedupe', async () => {
    const auth = vi.fn(({ next }) => next())

    const base = os.$config({ dedupeLeadingMiddlewares: false }).use(auth)
    const router = base.router({ ping: base.handler(() => 'pong') })

    await call(router.ping, undefined)
    expect(auth).toHaveBeenCalledTimes(2)
  })

  it('builder: dedupeLeadingMetaPlugins: false disables meta plugin dedupe', () => {
    const base = os.$config({ dedupeLeadingMetaPlugins: false }).meta(openapi({ tags: ['users'] }))
    const router = base.router({ ping: base.handler(() => 'pong') })

    expect(getOpenAPIMeta(router.ping)).toEqual(expect.objectContaining({ tags: ['users', 'users'] }))
  })

  it('implementer: runs a shared middleware once', async () => {
    const contract = {
      ping: oc.input(z.string()).output(z.string()),
    }

    const auth = vi.fn(({ next }) => next())
    const pub = implement(contract).use(auth)

    const router = pub.router({
      ping: pub.ping.handler(({ input }) => input),
    })

    await expect(call(router.ping, 'pong')).resolves.toBe('pong')
    expect(auth).toHaveBeenCalledTimes(1)
  })

  it('contract: applies shared meta plugins once', () => {
    const base = oc.meta(openapi({ tags: ['users'], prefix: '/api' }))

    const contract = base.router({
      ping: base.meta(openapi({ path: '/ping' })),
    })

    expect(getOpenAPIMeta(contract.ping)).toEqual(expect.objectContaining({ tags: ['users'], prefix: '/api', path: '/ping' }))
  })

  it('contract: dedupeLeadingMetaPlugins: false disables meta plugin dedupe', () => {
    const base = oc.$config({ dedupeLeadingMetaPlugins: false }).meta(openapi({ tags: ['users'] }))
    const contract = base.router({ ping: base.output(z.string()) })

    expect(getOpenAPIMeta(contract.ping)).toEqual(expect.objectContaining({ tags: ['users', 'users'] }))
  })
})
