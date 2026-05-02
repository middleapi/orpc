import { implement, lazy, os, Procedure, unlazy } from '@orpc/server'
import { router as contract } from '../../../../contract/tests/shared'
import { ping, pong } from '../../../../server/tests/shared'
import { StandardOpenAPIMatcher } from './openapi-matcher'

const routedPing = new Procedure({
  ...ping['~orpc'],
  route: {
    method: 'DELETE',
    path: '/ping/{ping}',
  },
})

const routedPong = new Procedure({
  ...pong['~orpc'],
  route: {
    method: 'GET',
    path: '/pong/{pong}',
  },
})

const router = {
  ping,
  pong: lazy(() => Promise.resolve({ default: routedPong })),
  nested: lazy(() => Promise.resolve({
    default: {
      ping: routedPing,
      pong: lazy(() => Promise.resolve({ default: pong })),
    },
  })),
}

describe('standardOpenAPIMatcher', () => {
  it('with router', async () => {
    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(router)

    expect(await rpcMatcher.match('POST', '/base')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('DELETE', '/ping/name')).toEqual({
      path: ['nested', 'ping'],
      procedure: routedPing,
      params: { ping: 'name' },
    })

    expect(await rpcMatcher.match('GET', '/pong/something')).toEqual({
      path: ['pong'],
      procedure: routedPong,
      params: { pong: 'something' },
    })

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('POST', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('POST', '/not_found')).toEqual(undefined)
  })

  it('with implemented router', async () => {
    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(implement(contract).$context<any>().router({
      ...router,
      pong: new Procedure({
        ...pong['~orpc'],
        errorMap: {
          SOMETHING_THAT_VIOLATES_THE_CONTRACT: {},
        },
        meta: {
          SOMETHING_THAT_VIOLATES_THE_CONTRACT: {},
        },
        route: {
          path: '/SOMETHING_THAT_VIOLATES_THE_CONTRACT',
        },
      }),
    }))

    expect(await rpcMatcher.match('POST', '/base')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('POST', '/pong')).toEqual({
      path: ['pong'],
      procedure: pong, // this mean the contract is applied to the procedure
    })

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('POST', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('POST', '/not_found')).toEqual(undefined)
  })

  it('with missing implementation', async () => {
    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(implement(contract).$context<any>().router({
      ...router,
      pong: undefined as any, // missing here
    }))

    // still work normally with other implementation
    expect(await rpcMatcher.match('POST', '/base')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(rpcMatcher.match('POST', '/pong')).rejects.toThrowError()

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('POST', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('POST', '/not_found')).toEqual(undefined)
  })

  it('lazy load lazy router', async () => {
    const pingLoader = vi.fn(() => Promise.resolve({ default: ping }))
    const pongLoader = vi.fn(() => Promise.resolve({ default: pong }))

    const rpcMatcher = new StandardOpenAPIMatcher()

    const base = os.$context<any>()

    const router = base.router({
      ping: base.prefix('/prefix1').lazy(pingLoader),
      pong: base.prefix('/prefix2').lazy(pongLoader),
      nested: base.prefix('/prefix3').router({
        ping: base.lazy(pingLoader),
        pong: base.lazy(pongLoader),
      }),
    })

    rpcMatcher.init(router)

    expect(await rpcMatcher.match('POST', '/prefix1/base')).toEqual({
      path: ['ping'],
      procedure: (await unlazy(router.ping)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(2)
    expect(pongLoader).toHaveBeenCalledTimes(0)

    // mean the result is cached
    expect(await rpcMatcher.match('POST', '/prefix1/base')).not.toBeUndefined()
    expect(pingLoader).toHaveBeenCalledTimes(2)
    expect(pongLoader).toHaveBeenCalledTimes(0)

    expect(await rpcMatcher.match('POST', '/pong')).toEqual({
      path: ['pong'],
      procedure: (await unlazy(router.pong)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(2)
    expect(pongLoader).toHaveBeenCalledTimes(2)

    expect(await rpcMatcher.match('POST', '/prefix3/base')).toEqual({
      path: ['nested', 'ping'],
      procedure: (await unlazy(router.nested.ping)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(4)
    expect(pongLoader).toHaveBeenCalledTimes(3)

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: (await unlazy(router.nested.pong)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(4)
    expect(pongLoader).toHaveBeenCalledTimes(4)

    expect(await rpcMatcher.match('POST', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('POST', '/not_found')).toEqual(undefined)

    expect(pingLoader).toHaveBeenCalledTimes(4)
    expect(pongLoader).toHaveBeenCalledTimes(4)
  })

  it('/ in path', async () => {
    const ping1 = new Procedure({
      ...ping['~orpc'],
      route: {
        method: 'GET',
        path: '/ping/{+ping}',
      },
    })

    const ping2 = new Procedure({
      ...ping['~orpc'],
      route: {
        method: 'GET',
        path: '/ping/{ping}',
      },
    })

    const ping3 = new Procedure({
      ...ping['~orpc'],
      route: {
        method: 'GET',
        path: '/ping/pong',
      },
    })

    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init({ ping1, ping2, ping3 })

    expect(await rpcMatcher.match('GET', '/ping/name%2F')).toEqual({
      path: ['ping2'],
      procedure: ping2,
      params: { ping: 'name/' },
    })

    expect(await rpcMatcher.match('GET', '/ping/name/')).toEqual({
      path: ['ping2'],
      procedure: ping2,
      params: { ping: 'name' },
    })

    expect(await rpcMatcher.match('GET', '/ping/name/2/3/4%2F5')).toEqual({
      path: ['ping1'],
      procedure: ping1,
      params: { ping: 'name/2/3/4/5' },
    })

    expect(await rpcMatcher.match('GET', '/ping/pong')).toEqual({
      path: ['ping3'],
      procedure: ping3,
      params: undefined,
    })
  })

  it('filter procedures', async () => {
    const rpcMatcher = new StandardOpenAPIMatcher({
      filter: (options) => {
        if (options.path.includes('ping')) {
          return false
        }

        return true
      },
    })
    rpcMatcher.init(router)

    expect(await rpcMatcher.match('POST', '/base')).toEqual(undefined)
    expect(await rpcMatcher.match('DELETE', '/ping/name')).toEqual(undefined)

    expect(await rpcMatcher.match('GET', '/pong/something')).toEqual({
      path: ['pong'],
      procedure: routedPong,
      params: { pong: 'something' },
    })
  })
})
