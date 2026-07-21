import type { RouterUtilsPlugin } from './plugin'
import * as KeyModule from './key'
import { ProcedureUtils } from './procedure-utils'
import { createRouterUtils } from './router-utils'

vi.mock('./procedure-utils', async () => {
  const { SharedUtils } = await import('./shared-utils')

  return {
    ProcedureUtils: vi.fn(class extends SharedUtils<unknown> {
      call = vi.fn()
      override key = SharedUtils.prototype.key
      queryOptions = vi.fn(() => ({ queryOptions: true }))
      mutationOptions = vi.fn(() => ({ mutationOptions: true }))

      constructor(path: string[], _client: unknown, options: any = {}) {
        super(path, options)
      }
    }),
  }
})

const generateOperationKeySpy = vi.spyOn(KeyModule, 'generateOperationKey')

const emptyInterceptors = {
  queryInterceptors: [],
  streamedInterceptors: [],
  liveInterceptors: [],
  infiniteInterceptors: [],
  mutationInterceptors: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRouterUtils', () => {
  const client = vi.fn() as any
  client.key = vi.fn() // "key" mean client can handle when client and method is conflict
  client.key.pong = vi.fn()

  it('creates nested procedure & shared utils', () => {
    const utils = createRouterUtils(client, {
      prefix: '__prefix__',
    }) as any

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith([], client, { ...emptyInterceptors, prefix: '__prefix__' })
    expect(utils.key({ type: 'query' })).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, [], { type: 'query', prefix: '__prefix__' })
    expect(utils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key'], client.key, { ...emptyInterceptors, prefix: '__prefix__' })
    expect(keyUtils.key({ type: 'mutation' })).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, ['key'], { type: 'mutation', prefix: '__prefix__' })
    expect(keyUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)

    vi.clearAllMocks()
    const pongUtils = keyUtils.pong

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key', 'pong'], client.key.pong, { ...emptyInterceptors, prefix: '__prefix__' })
    expect(pongUtils.key({ type: 'query' })).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, ['key', 'pong'], { type: 'query', prefix: '__prefix__' })
    expect(pongUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)
  })

  it('works with plain object routers', () => {
    const router = { nested: { ping: vi.fn() } } as any
    const utils = createRouterUtils(router) as any

    expect(ProcedureUtils).toHaveBeenCalledTimes(0)
    expect(utils.queryOptions).toBeUndefined()
    expect(utils.key()).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, [], { prefix: undefined })

    const nestedUtils = utils.nested

    expect(ProcedureUtils).toHaveBeenCalledTimes(0)
    expect(nestedUtils.key()).toBe(generateOperationKeySpy.mock.results[1]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(2, ['nested'], { prefix: undefined })

    const pingUtils = nestedUtils.ping

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['nested', 'ping'], router.nested.ping, emptyInterceptors)
    expect(pingUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)
  })

  it('stops recursive on symbol', () => {
    const utils = createRouterUtils(client) as any
    expect(utils[Symbol.for('a')]).toBe(undefined)
  })

  it('stops recursive on RECURSIVE_CLIENT_UNWRAP_KEYS', () => {
    client.then = vi.fn()

    try {
      const utils = createRouterUtils(client) as any

      expect(utils.then).toBe(undefined)
      expect(ProcedureUtils).toHaveBeenCalledTimes(1) // only the root utils
    }
    finally {
      delete client.then
    }
  })

  it('stops recursive when nested client is not an object', () => {
    const utils = createRouterUtils(client) as any

    expect(utils.nonExistent).toBe(undefined)
  })

  it('stops recursive on symbol & RECURSIVE_CLIENT_UNWRAP_KEYS inside conflicted utils', () => {
    client.key.bind = vi.fn()

    try {
      const utils = createRouterUtils(client) as any
      const keyUtils = utils.key

      expect(keyUtils[Symbol.for('a')]).toBe(undefined)

      vi.clearAllMocks()
      expect(typeof keyUtils.bind).toBe('function') // Function.prototype.bind, not a nested utils
      expect(ProcedureUtils).toHaveBeenCalledTimes(0)
    }
    finally {
      delete client.key.bind
    }
  })

  it('supports scoped options', () => {
    const keyOptions = {
      queryOptions: {
        staleTime: 1000,
      },
      mutationOptions: {
        context: { foo: 'bar' },
      },
    }

    const utils = createRouterUtils(client, {
      scoped: {
        key: keyOptions,
      },
    } as any) as any

    vi.clearAllMocks()
    const keyUtils = utils.key
    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key'], client.key, { ...keyOptions, ...emptyInterceptors })

    vi.clearAllMocks()
    const pongUtils = keyUtils.pong
    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key', 'pong'], client.key.pong, emptyInterceptors)
    expect(pongUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)
  })

  it('merges interceptors and applies plugin hooks before creating procedure utils', () => {
    const client = {
      route: vi.fn(({ next }) => next()),
    } as any

    const queryInterceptors = {
      root: vi.fn(({ next }) => next()),
      init: vi.fn(({ next }) => next()),
      scoped: vi.fn(({ next }) => next()),
      procedure: vi.fn(({ next }) => next()),
    }
    const streamedInterceptors = {
      root: vi.fn(({ next }) => next()),
      init: vi.fn(({ next }) => next()),
      scoped: vi.fn(({ next }) => next()),
    }
    const liveInterceptors = {
      root: vi.fn(({ next }) => next()),
      init: vi.fn(({ next }) => next()),
      scoped: vi.fn(({ next }) => next()),
    }
    const infiniteInterceptors = {
      root: vi.fn(({ next }) => next()),
      init: vi.fn(({ next }) => next()),
      scoped: vi.fn(({ next }) => next()),
    }
    const mutationInterceptors = {
      root: vi.fn(({ next }) => next()),
      init: vi.fn(({ next }) => next()),
      scoped: vi.fn(({ next }) => next()),
    }

    const plugin = {
      name: 'test-plugin',
      init: vi.fn((options: any) => ({
        ...options,
        queryInterceptors: [...options.queryInterceptors, queryInterceptors.init],
        streamedInterceptors: [...options.streamedInterceptors, streamedInterceptors.init],
        liveInterceptors: [...options.liveInterceptors, liveInterceptors.init],
        infiniteInterceptors: [...options.infiniteInterceptors, infiniteInterceptors.init],
        mutationInterceptors: [...options.mutationInterceptors, mutationInterceptors.init],
      })),
      initProcedureOptions: vi.fn((path: string[], options: any) => ({
        ...options,
        queryInterceptors: [...options.queryInterceptors, queryInterceptors.procedure],
        queryOptions: {
          ...options.queryOptions,
          staleTime: path.length * 100,
        },
      })),
    } satisfies RouterUtilsPlugin<any>

    const utils = createRouterUtils(client, {
      queryInterceptors: [queryInterceptors.root],
      streamedInterceptors: [streamedInterceptors.root],
      liveInterceptors: [liveInterceptors.root],
      infiniteInterceptors: [infiniteInterceptors.root],
      mutationInterceptors: [mutationInterceptors.root],
      scoped: {
        route: {
          queryInterceptors: [queryInterceptors.scoped],
          streamedInterceptors: [streamedInterceptors.scoped],
          liveInterceptors: [liveInterceptors.scoped],
          infiniteInterceptors: [infiniteInterceptors.scoped],
          mutationInterceptors: [mutationInterceptors.scoped],
          queryOptions: {
            gcTime: 1000,
          },
        },
      },
      plugins: [plugin],
    } as any) as any

    expect(plugin.init).toHaveBeenCalledOnce()
    expect(plugin.init).toHaveBeenCalledWith(expect.objectContaining({
      queryInterceptors: [queryInterceptors.root],
      streamedInterceptors: [streamedInterceptors.root],
      liveInterceptors: [liveInterceptors.root],
      infiniteInterceptors: [infiniteInterceptors.root],
      mutationInterceptors: [mutationInterceptors.root],
    }))

    const routeUtils = utils.route

    expect(plugin.initProcedureOptions).toHaveBeenCalledOnce()
    expect(plugin.initProcedureOptions).toHaveBeenCalledWith(['route'], expect.objectContaining({
      queryInterceptors: [queryInterceptors.root, queryInterceptors.init, queryInterceptors.scoped],
      streamedInterceptors: [streamedInterceptors.root, streamedInterceptors.init, streamedInterceptors.scoped],
      liveInterceptors: [liveInterceptors.root, liveInterceptors.init, liveInterceptors.scoped],
      infiniteInterceptors: [infiniteInterceptors.root, infiniteInterceptors.init, infiniteInterceptors.scoped],
      mutationInterceptors: [mutationInterceptors.root, mutationInterceptors.init, mutationInterceptors.scoped],
      queryOptions: {
        gcTime: 1000,
      },
    }))

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['route'], client.route, expect.objectContaining({
      queryInterceptors: [queryInterceptors.root, queryInterceptors.init, queryInterceptors.scoped, queryInterceptors.procedure],
      streamedInterceptors: [streamedInterceptors.root, streamedInterceptors.init, streamedInterceptors.scoped],
      liveInterceptors: [liveInterceptors.root, liveInterceptors.init, liveInterceptors.scoped],
      infiniteInterceptors: [infiniteInterceptors.root, infiniteInterceptors.init, infiniteInterceptors.scoped],
      mutationInterceptors: [mutationInterceptors.root, mutationInterceptors.init, mutationInterceptors.scoped],
      queryOptions: {
        gcTime: 1000,
        staleTime: 100,
      },
    }))

    expect(routeUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)
  })

  it.each([
    'queryInterceptors',
    'streamedInterceptors',
    'liveInterceptors',
    'infiniteInterceptors',
    'mutationInterceptors',
  ] as const)('does not create procedure utils for invalid %s scoped options', (key) => {
    const client = {
      route: vi.fn(),
    } as any
    client.route = vi.fn()
    client.route.child = vi.fn()

    const utils = createRouterUtils(client, {
      scoped: {
        route: {
          [key]: { invalid: true },
          child: {
            queryOptions: {
              staleTime: 1000,
            },
          },
        } as any,
      },
    } as any) as any

    const routeUtils = utils.route

    expect(typeof routeUtils.key).toBe('function')
    expect(typeof routeUtils.queryOptions).not.toBe('function')
    expect(ProcedureUtils).toHaveBeenCalledTimes(0)

    vi.clearAllMocks()
    const childUtils = routeUtils.child

    expect(typeof childUtils.key).toBe('function')
    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
  })

  it('does not create procedure utils for invalid scoped options', () => {
    const client = {
      route: vi.fn(),
    } as any

    const utils = createRouterUtils(client, {
      scoped: {
        route: 'invalid' as any,
      },
    } as any) as any

    expect(typeof utils.route.key).toBe('function')
    expect(typeof utils.route.queryOptions).not.toBe('function')
    expect(ProcedureUtils).toHaveBeenCalledTimes(0)
  })
})
