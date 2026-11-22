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

  it('lazy router inside lazy router with concurrent requests', async () => {
    const base = os.$context<any>()

    const resolvers: ((value: { default: any }) => void)[] = []
    const nestedLoader = vi.fn(() => new Promise<{ default: any }>((resolve) => {
      resolvers.push(resolve)
    }))
    const pongLoader = vi.fn(() => Promise.resolve({ default: pong }))

    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(base.router({
      nested: base.lazy(nestedLoader),
    }))
    const initSpy = vi.spyOn(rpcMatcher, 'init')

    const match1 = rpcMatcher.match('POST', '/nested/pong')
    const match2 = rpcMatcher.match('POST', '/nested/pong')

    // each request loads on its own
    expect(nestedLoader).toHaveBeenCalledTimes(2)

    resolvers.forEach(resolve => resolve({ default: { pong: base.lazy(pongLoader) } }))

    expect(await match1).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await match2).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    // but each lazy router is indexed once
    expect(initSpy.mock.calls.map(([, path]) => path)).toEqual([['nested'], ['nested', 'pong']])

    // subsequent requests still work without reloading
    const nestedCalls = nestedLoader.mock.calls.length
    const pongCalls = pongLoader.mock.calls.length

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(nestedLoader).toHaveBeenCalledTimes(nestedCalls)
    expect(pongLoader).toHaveBeenCalledTimes(pongCalls)
    expect(initSpy).toHaveBeenCalledTimes(2)
  })

  it('a lazy router load that never settles does not block other requests', async () => {
    const base = os.$context<any>()

    const nestedLoader = vi.fn()
      // e.g. on Cloudflare Workers, the request that started this load has ended
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({ default: { pong } })

    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(base.router({
      nested: base.lazy(nestedLoader),
    }))

    void rpcMatcher.match('POST', '/nested/pong')

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('POST', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(nestedLoader).toHaveBeenCalledTimes(2)
  })

  it('multiple lazy routers with lazy router inside lazy router', async () => {
    const base = os.$context<any>()

    const userFindLoader = vi.fn(() => Promise.resolve({ default: pong }))
    const usersLoader = vi.fn(() => Promise.resolve({
      default: {
        find: base.lazy(userFindLoader),
      },
    }))

    const planetDeepLoader = vi.fn(() => Promise.resolve({ default: pong }))
    const planetNestedLoader = vi.fn(() => Promise.resolve({
      default: {
        deep: base.lazy(planetDeepLoader),
      },
    }))
    const planetsLoader = vi.fn(() => Promise.resolve({
      default: {
        nested: base.lazy(planetNestedLoader),
        pong,
      },
    }))

    const unusedLoader = vi.fn(() => Promise.resolve({ default: pong }))

    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(base.router({
      users: base.prefix('/users').lazy(usersLoader),
      planets: base.prefix('/planets').lazy(planetsLoader),
      unused: base.prefix('/unused').lazy(unusedLoader),
    }))
    const initSpy = vi.spyOn(rpcMatcher, 'init')
    const indexedPaths = () => initSpy.mock.calls.map(([, path]) => path!.join('.')).sort()

    // concurrent requests across different lazy branches
    const [match1, match2, match3] = await Promise.all([
      rpcMatcher.match('POST', '/users/find'),
      rpcMatcher.match('POST', '/planets/nested/deep'),
      rpcMatcher.match('POST', '/planets/pong'),
    ])

    expect(match1).toEqual({
      path: ['users', 'find'],
      procedure: pong,
    })

    expect(match2).toEqual({
      path: ['planets', 'nested', 'deep'],
      procedure: pong,
    })

    expect(match3).toEqual({
      path: ['planets', 'pong'],
      procedure: pong,
    })

    // each matched lazy router is indexed once
    expect(indexedPaths()).toEqual(['planets', 'planets.nested', 'planets.nested.deep', 'users', 'users.find'])

    // prefixed router not matched by any request stays lazy
    expect(unusedLoader).toHaveBeenCalledTimes(0)

    // subsequent requests still work without reloading
    const loaders = [usersLoader, userFindLoader, planetsLoader, planetNestedLoader, planetDeepLoader]
    const loaderCalls = loaders.map(loader => loader.mock.calls.length)

    expect(await rpcMatcher.match('POST', '/planets/nested/deep')).toEqual({
      path: ['planets', 'nested', 'deep'],
      procedure: pong,
    })

    expect(loaders.map(loader => loader.mock.calls.length)).toEqual(loaderCalls)
    expect(unusedLoader).toHaveBeenCalledTimes(0)
    expect(initSpy).toHaveBeenCalledTimes(5)
  })

  it('lazy router can retry after loader failure', async () => {
    const base = os.$context<any>()

    const pongLoader = vi.fn()
      .mockRejectedValueOnce(new Error('loader failed'))
      .mockResolvedValueOnce({ default: pong })

    const rpcMatcher = new StandardOpenAPIMatcher()
    rpcMatcher.init(base.router({
      pong: base.lazy(pongLoader),
    }))

    await expect(rpcMatcher.match('POST', '/pong')).rejects.toThrow('loader failed')

    expect(await rpcMatcher.match('POST', '/pong')).toEqual({
      path: ['pong'],
      procedure: pong,
    })

    expect(pongLoader).toHaveBeenCalledTimes(2)
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
