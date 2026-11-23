import { router as contract } from '../../../../contract/tests/shared'
import { ping, pong, router } from '../../../tests/shared'
import { os } from '../../builder'
import { implement } from '../../implementer'
import { unlazy } from '../../lazy'
import { Procedure } from '../../procedure'
import { StandardRPCMatcher } from './rpc-matcher'

describe('standardRPCMatcher', () => {
  it('with router', async () => {
    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(router)

    expect(await rpcMatcher.match('ANYTHING', '/ping')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('ANYTHING', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('ANYTHING', '/pong')).toEqual({
      path: ['pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('ANYTHING', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('ANYTHING', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('ANYTHING', '/not_found')).toEqual(undefined)
  })

  it('with implemented router', async () => {
    const rpcMatcher = new StandardRPCMatcher()
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

    expect(await rpcMatcher.match('ANYTHING', '/ping')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('ANYTHING', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('ANYTHING', '/pong')).toEqual({
      path: ['pong'],
      procedure: pong, // this mean the contract is applied to the procedure
    })

    expect(await rpcMatcher.match('ANYTHING', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('ANYTHING', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('ANYTHING', '/not_found')).toEqual(undefined)
  })

  it('with missing implementation', async () => {
    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(implement(contract).$context<any>().router({
      ...router,
      pong: undefined as any, // missing here
    }))

    // still work normally with other implementation
    expect(await rpcMatcher.match('ANYTHING', '/ping')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('ANYTHING', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(rpcMatcher.match('ANYTHING', '/pong')).rejects.toThrowError()

    expect(await rpcMatcher.match('ANYTHING', '/nested/pong')).toEqual({
      path: ['nested', 'pong'],
      procedure: pong,
    })

    expect(await rpcMatcher.match('ANYTHING', '/')).toEqual(undefined)
    expect(await rpcMatcher.match('ANYTHING', '/not_found')).toEqual(undefined)
  })

  it('lazy load lazy router', async () => {
    const pingLoader = vi.fn(() => Promise.resolve({ default: ping }))
    const pongLoader = vi.fn(() => Promise.resolve({ default: pong }))

    const rpcMatcher = new StandardRPCMatcher()

    const base = os.$context<any>()

    const router = base.router({
      ping: base.lazy(pingLoader),
      pong: base.lazy(pongLoader),
      nested: base.router({
        ping: base.lazy(pingLoader),
        pong: base.lazy(pongLoader),
      }),
    })

    rpcMatcher.init(router)

    expect(await rpcMatcher.match('POST', '/ping')).toEqual({
      path: ['ping'],
      procedure: (await unlazy(router.ping)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(2)
    expect(pongLoader).toHaveBeenCalledTimes(0)

    // mean the result is cached
    expect(await rpcMatcher.match('POST', '/ping')).not.toBeUndefined()
    expect(pingLoader).toHaveBeenCalledTimes(2)
    expect(pongLoader).toHaveBeenCalledTimes(0)

    expect(await rpcMatcher.match('POST', '/pong')).toEqual({
      path: ['pong'],
      procedure: (await unlazy(router.pong)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(2)
    expect(pongLoader).toHaveBeenCalledTimes(2)

    expect(await rpcMatcher.match('POST', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: (await unlazy(router.nested.ping)).default,
    })

    expect(pingLoader).toHaveBeenCalledTimes(4)
    expect(pongLoader).toHaveBeenCalledTimes(2)

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
    const pingLoader = vi.fn(() => Promise.resolve({ default: ping }))

    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(base.router({
      pong,
      nested: base.lazy(nestedLoader),
    }))
    const initSpy = vi.spyOn(rpcMatcher, 'init')

    const match1 = rpcMatcher.match('POST', '/nested/ping')
    const match2 = rpcMatcher.match('POST', '/nested/ping')
    // non-matching request should not wait for or drop pending lazy routers
    const match3 = rpcMatcher.match('POST', '/pong')

    // each request loads on its own
    expect(nestedLoader).toHaveBeenCalledTimes(2)

    expect(await match3).toEqual({
      path: ['pong'],
      procedure: pong,
    })

    resolvers.forEach(resolve => resolve({ default: { ping: base.lazy(pingLoader) } }))

    expect(await match1).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(await match2).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    // but each lazy router is indexed once
    expect(initSpy.mock.calls.map(([, path]) => path)).toEqual([['nested'], ['nested', 'ping']])

    // subsequent requests still work without reloading
    const nestedCalls = nestedLoader.mock.calls.length
    const pingCalls = pingLoader.mock.calls.length

    expect(await rpcMatcher.match('POST', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(nestedLoader).toHaveBeenCalledTimes(nestedCalls)
    expect(pingLoader).toHaveBeenCalledTimes(pingCalls)
    expect(initSpy).toHaveBeenCalledTimes(2)
  })

  it('a lazy router load that never settles does not block other requests', async () => {
    const base = os.$context<any>()

    const nestedLoader = vi.fn()
      // e.g. on Cloudflare Workers, the request that started this load has ended
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({ default: { ping } })

    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(base.router({
      nested: base.lazy(nestedLoader),
    }))

    void rpcMatcher.match('POST', '/nested/ping')

    expect(await rpcMatcher.match('POST', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('POST', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(nestedLoader).toHaveBeenCalledTimes(2)
  })

  it('matches while another match is still loading, and drops the slower load', async () => {
    const base = os.$context<any>()

    let resolveFirst!: (value: { default: any }) => void
    const nestedLoader = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({ default: { ping } })

    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(base.router({
      nested: base.lazy(nestedLoader),
    }))
    const initSpy = vi.spyOn(rpcMatcher, 'init')

    const slow = rpcMatcher.match('POST', '/nested/ping')

    expect(await rpcMatcher.match('POST', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    // the slower load finishes with a different router, which must not be indexed
    resolveFirst({ default: { ping: pong } })

    expect(await slow).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(await rpcMatcher.match('POST', '/nested/ping')).toEqual({
      path: ['nested', 'ping'],
      procedure: ping,
    })

    expect(initSpy).toHaveBeenCalledTimes(1)
  })

  it('multiple lazy routers with lazy router inside lazy router', async () => {
    const base = os.$context<any>()

    const userFindLoader = vi.fn(() => Promise.resolve({ default: ping }))
    const userListLoader = vi.fn(() => Promise.resolve({ default: pong }))
    const usersLoader = vi.fn(() => Promise.resolve({
      default: {
        find: base.lazy(userFindLoader),
        list: base.lazy(userListLoader),
      },
    }))

    const planetDeepLoader = vi.fn(() => Promise.resolve({ default: ping }))
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

    const unusedLoader = vi.fn(() => Promise.resolve({ default: ping }))

    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(base.router({
      users: base.lazy(usersLoader),
      planets: base.lazy(planetsLoader),
      unused: base.lazy(unusedLoader),
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
      procedure: ping,
    })

    expect(match2).toEqual({
      path: ['planets', 'nested', 'deep'],
      procedure: ping,
    })

    expect(match3).toEqual({
      path: ['planets', 'pong'],
      procedure: pong,
    })

    // each matched lazy router is indexed once
    expect(indexedPaths()).toEqual(['planets', 'planets.nested', 'planets.nested.deep', 'users', 'users.find'])

    // routers not matched by any request stay lazy
    expect(userListLoader).toHaveBeenCalledTimes(0)
    expect(unusedLoader).toHaveBeenCalledTimes(0)

    // remaining pending routers still resolvable afterwards
    const usersCalls = usersLoader.mock.calls.length

    expect(await rpcMatcher.match('POST', '/users/list')).toEqual({
      path: ['users', 'list'],
      procedure: pong,
    })

    expect(usersLoader).toHaveBeenCalledTimes(usersCalls)
    expect(userListLoader).toHaveBeenCalledTimes(1)
    expect(unusedLoader).toHaveBeenCalledTimes(0)
    expect(indexedPaths()).toEqual(['planets', 'planets.nested', 'planets.nested.deep', 'users', 'users.find', 'users.list'])
  })

  it('lazy router can retry after loader failure', async () => {
    const base = os.$context<any>()

    const pingLoader = vi.fn()
      .mockRejectedValueOnce(new Error('loader failed'))
      .mockResolvedValueOnce({ default: ping })

    const rpcMatcher = new StandardRPCMatcher()
    rpcMatcher.init(base.router({
      ping: base.lazy(pingLoader),
    }))

    await expect(rpcMatcher.match('POST', '/ping')).rejects.toThrow('loader failed')

    expect(await rpcMatcher.match('POST', '/ping')).toEqual({
      path: ['ping'],
      procedure: ping,
    })

    expect(pingLoader).toHaveBeenCalledTimes(2)
  })

  it('filter procedures', async () => {
    const rpcMatcher = new StandardRPCMatcher({
      filter: (options) => {
        if (options.path.includes('ping')) {
          return false
        }

        return true
      },
    })
    rpcMatcher.init(router)

    expect(await rpcMatcher.match('ANYTHING', '/ping')).toEqual(undefined)
    expect(await rpcMatcher.match('ANYTHING', '/nested/ping')).toEqual(undefined)

    expect(await rpcMatcher.match('ANYTHING', '/pong')).toEqual({
      path: ['pong'],
      procedure: pong,
    })
  })
})
