import type { RouterUtilsPlugin } from './plugin'
import * as KeyModule from './key'
import { ProcedureUtils } from './procedure-utils'
import { createRouterUtils, SharedRouterUtils } from './router-utils'

vi.mock('./procedure-utils', async () => ({
  ProcedureUtils: vi.fn(class {
    call = vi.fn()
    queryOptions = vi.fn(() => ({ queryOptions: true }))
    mutationOptions = vi.fn(() => ({ mutationOptions: true }))
  }),
}))

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

describe('sharedRouterUtils', () => {
  const utils = new SharedRouterUtils(['path'])

  it('.key', () => {
    expect(
      utils.key({ input: { search: '__search__' }, type: 'infinite' }),
    ).toBe(generateOperationKeySpy.mock.results[0]!.value)

    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['path'], { input: { search: '__search__' }, type: 'infinite' })
  })
})

describe('createRouterUtils', () => {
  const client = vi.fn() as any
  client.key = vi.fn() // "key" mean client can handle when client and method is conflict
  client.key.pong = vi.fn()

  it('create nested procedure & shared utils', () => {
    const utils = createRouterUtils(client, {
      path: ['__base__'],
    }) as any

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['__base__'], client, emptyInterceptors)
    expect(utils.key({ type: 'infinite' })).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, ['__base__'], { type: 'infinite' })
    expect(utils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['__base__', 'key'], client.key, emptyInterceptors)
    expect(keyUtils.key({ type: 'live' })).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, ['__base__', 'key'], { type: 'live' })
    expect(keyUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)

    vi.clearAllMocks()
    const pongUtils = keyUtils.pong

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['__base__', 'key', 'pong'], client.key.pong, emptyInterceptors)
    expect(pongUtils.key({ type: 'query' })).toBe(generateOperationKeySpy.mock.results[0]?.value)
    expect(generateOperationKeySpy).toHaveBeenNthCalledWith(1, ['__base__', 'key', 'pong'], { type: 'query' })
    expect(pongUtils.queryOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.queryOptions.mock.results[0]?.value)
  })

  it('stops recursive on symbol', async () => {
    const utils = createRouterUtils(client) as any
    expect(utils[Symbol.for('a')]).toBe(undefined)
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
    }) as any

    vi.clearAllMocks()
    const keyUtils = utils.key
    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key'], client.key, { ...keyOptions, ...emptyInterceptors })

    vi.clearAllMocks()
    const pongUtils = keyUtils.pong
    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key', 'pong'], client.key.pong, emptyInterceptors)
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
    }) as any

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
    }) as any

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
    }) as any

    expect(typeof utils.route.key).toBe('function')
    expect(typeof utils.route.queryOptions).not.toBe('function')
    expect(ProcedureUtils).toHaveBeenCalledTimes(0)
  })

  it('does not create utils for undefined or unwrap client path', () => {
    const client = {
      route: vi.fn(),
    } as any

    const utils = createRouterUtils(client) as any
    expect(utils.undefined).toBe(undefined)
    const call = utils.route.call
    expect(call.bind).toBe(call.bind)
    expect(call[Symbol('undefined')]).toBeUndefined()
  })
})
