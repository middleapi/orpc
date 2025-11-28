import { QueryClient, skipToken } from '@tanstack/query-core'
import * as KeyModule from './key'
import * as LiveQuery from './live-query'
import { createProcedureUtils } from './procedure-utils'
import * as streamQueryModule from './stream-query'
import { OPERATION_CONTEXT_SYMBOL } from './types'

const streamedQuerySpy = vi.spyOn(streamQueryModule, 'experimental_serializableStreamedQuery')

const liveQuerySpy = vi.spyOn(LiveQuery, 'experimental_liveQuery')

const generateOperationKeySpy = vi.spyOn(KeyModule, 'generateOperationKey')

const queryClient = new QueryClient()

beforeEach(() => {
  queryClient.clear()
  vi.clearAllMocks()
})

describe('createProcedureUtils', () => {
  const signal = new AbortController().signal
  const client = vi.fn()
  const utils = createProcedureUtils(client, { path: ['ping'] })

  it('.call', () => {
    expect(utils.call).toBe(client)
  })

  it('.queryKey', () => {
    expect(utils.queryKey({ input: { search: '__search__' } })).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { search: '__search__' } })

    expect(utils.queryKey({ queryKey: ['1'] })).toEqual(['1'])
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
  })

  describe('.queryOptions', () => {
    it('without skipToken', async () => {
      const options = utils.queryOptions({ input: { search: '__search__' }, context: { batch: '__batch__' } })

      expect('enabled' in options).toBe(false)
      expect(options.enabled).toBeUndefined()

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { search: '__search__' } })

      client.mockResolvedValueOnce('__output__')
      await expect(options.queryFn!({ signal } as any)).resolves.toEqual('__output__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, { signal, context: {
        batch: '__batch__',
        [OPERATION_CONTEXT_SYMBOL]: {
          key: options.queryKey,
          type: 'query',
        },
      } })
    })

    it('with skipToken', async () => {
      const options = utils.queryOptions({ input: skipToken, context: { batch: '__batch__' } })

      expect(options.enabled).toBe(false)

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: skipToken })

      expect(() => options.queryFn!({ signal } as any)).toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)
    })
  })

  it('.streamedKey', () => {
    expect(utils.experimental_streamedKey({ input: { search: '__search__' } })).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'streamed', input: { search: '__search__' } })

    expect(utils.experimental_streamedKey({ queryKey: ['1'] })).toEqual(['1'])
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
  })

  describe('.streamedOptions', () => {
    it('without skipToken', async () => {
      const options = utils.experimental_streamedOptions({
        input: { search: '__search__' },
        context: { batch: '__batch__' },
        queryFnOptions: {
          refetchMode: 'replace',
        },
      })

      expect('enabled' in options).toBe(false)
      expect(options.enabled).toBeUndefined()

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], {
        type: 'streamed',
        input: { search: '__search__' },
        fnOptions: {
          refetchMode: 'replace',
        },
      })

      expect(options.queryFn).toBe(vi.mocked(streamedQuerySpy).mock.results[0]!.value)
      expect(streamedQuerySpy).toHaveBeenCalledTimes(1)
      expect(streamedQuerySpy).toHaveBeenCalledWith(expect.any(Function), {
        refetchMode: 'replace',
      })

      client.mockImplementationOnce(async function* (input) {
        yield '__1__'
        yield '__2__'
        return '__3__'
      })
      await expect(options.queryFn!({ signal, client: queryClient, queryKey: options.queryKey } as any)).resolves.toEqual(['__1__', '__2__'])
      expect(queryClient.getQueryData(options.queryKey)).toEqual(['__1__', '__2__'])

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, {
        signal,
        context: {
          batch: '__batch__',
          [OPERATION_CONTEXT_SYMBOL]: {
            key: options.queryKey,
            type: 'streamed',
          },
        },
      })
    })

    it('with skipToken', async () => {
      const options = utils.experimental_streamedOptions({ input: skipToken, context: { batch: '__batch__' } })

      expect(options.enabled).toBe(false)

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'streamed', input: skipToken })

      await expect(options.queryFn!({ signal, client: queryClient } as any)).rejects.toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)
    })

    it('with unsupported output', async () => {
      const options = utils.experimental_streamedOptions({ input: { search: '__search__' }, context: { batch: '__batch__' } })

      client.mockResolvedValueOnce('INVALID')
      await expect(options.queryFn!({ signal, client: queryClient } as any)).rejects.toThrow('streamedQuery requires an event iterator output')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, { signal, context: {
        batch: '__batch__',
        [OPERATION_CONTEXT_SYMBOL]: {
          key: options.queryKey,
          type: 'streamed',
        },
      } })
    })
  })

  it('.liveKey', () => {
    expect(utils.experimental_liveKey({ input: { search: '__search__' } })).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'live', input: { search: '__search__' } })

    expect(utils.experimental_liveKey({ queryKey: ['1'] })).toEqual(['1'])
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
  })

  describe('.liveOptions', () => {
    it('without skipToken', async () => {
      const options = utils.experimental_liveOptions({
        input: { search: '__search__' },
        context: { batch: '__batch__' },
      })

      expect('enabled' in options).toBe(false)
      expect(options.enabled).toBeUndefined()

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], {
        type: 'live',
        input: { search: '__search__' },
      })

      expect(options.queryFn).toBe(vi.mocked(liveQuerySpy).mock.results[0]!.value)
      expect(liveQuerySpy).toHaveBeenCalledTimes(1)
      expect(liveQuerySpy).toHaveBeenCalledWith(expect.any(Function))

      client.mockImplementationOnce(async function* (input) {
        yield '__1__'
        yield '__2__'
        return '__3__'
      })
      await expect(options.queryFn!({ signal, client: queryClient, queryKey: options.queryKey } as any)).resolves.toEqual('__2__')
      expect(queryClient.getQueryData(options.queryKey)).toEqual('__2__')

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, {
        signal,
        context: {
          batch: '__batch__',
          [OPERATION_CONTEXT_SYMBOL]: {
            key: options.queryKey,
            type: 'live',
          },
        },
      })
    })

    it('with skipToken', async () => {
      const options = utils.experimental_liveOptions({ input: skipToken, context: { batch: '__batch__' } })

      expect(options.enabled).toBe(false)

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'live', input: skipToken })

      await expect(options.queryFn!({ signal, client: queryClient } as any)).rejects.toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)
    })

    it('with unsupported output', async () => {
      const options = utils.experimental_liveOptions({ input: { search: '__search__' }, context: { batch: '__batch__' } })

      client.mockResolvedValueOnce('INVALID')
      await expect(options.queryFn!({ signal, client: queryClient } as any)).rejects.toThrow('liveQuery requires an event iterator output')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, {
        signal,
        context: {
          batch: '__batch__',
          [OPERATION_CONTEXT_SYMBOL]: {
            key: options.queryKey,
            type: 'live',
          },
        },
      })
    })
  })

  it('.infiniteKey', () => {
    expect(utils.infiniteKey({ input: pageParam => ({ search: '__search__', pageParam }), initialPageParam: '__initialPageParam__' })).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'infinite', input: { search: '__search__', pageParam: '__initialPageParam__' } })

    expect(utils.infiniteKey({ input: () => ({}), initialPageParam: 0, queryKey: ['1'] })).toEqual(['1'])
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
  })

  describe('.infiniteOptions', () => {
    it('without skipToken', async () => {
      const getNextPageParam = vi.fn()

      const options = utils.infiniteOptions({
        input: pageParam => ({ search: '__search__', pageParam }),
        context: { batch: '__batch__' },
        getNextPageParam,
        initialPageParam: '__initialPageParam__',
      })

      expect('enabled' in options).toBe(false)
      expect(options.enabled).toBeUndefined()

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'infinite', input: { search: '__search__', pageParam: '__initialPageParam__' } })

      expect(options.initialPageParam).toEqual('__initialPageParam__')
      expect(options.getNextPageParam).toBe(getNextPageParam)

      client.mockResolvedValueOnce('__output__')
      await expect(options.queryFn!({ signal, pageParam: '__pageParam__' } as any)).resolves.toEqual('__output__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith(
        { search: '__search__', pageParam: '__pageParam__' },
        {
          signal,
          context: {
            batch: '__batch__',
            [OPERATION_CONTEXT_SYMBOL]: {
              key: options.queryKey,
              type: 'infinite',
            },
          },
        },
      )
    })

    it('with skipToken', async () => {
      const getNextPageParam = vi.fn()

      const options = utils.infiniteOptions({
        input: skipToken,
        context: { batch: '__batch__' },
        getNextPageParam,
        initialPageParam: '__initialPageParam__',
      })

      expect(options.enabled).toBe(false)

      expect(options.queryKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'infinite', input: skipToken })

      expect(options.initialPageParam).toEqual('__initialPageParam__')
      expect(options.getNextPageParam).toBe(getNextPageParam)

      expect(() => options.queryFn!({ signal, pageParam: '__pageParam__' } as any)).toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)
    })
  })

  it('.mutationKey', () => {
    expect(utils.mutationKey()).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation' })

    expect(utils.mutationKey({ mutationKey: ['1'] })).toEqual(['1'])
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
  })

  it('.mutationOptions', async () => {
    const options = utils.mutationOptions({
      context: { batch: '__batch__' },
    })

    expect(options.mutationKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation' })

    client.mockResolvedValueOnce('__output__')
    await expect(options.mutationFn!('__input__', {} as any)).resolves.toEqual('__output__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith('__input__', { context: {
      batch: '__batch__',
      [OPERATION_CONTEXT_SYMBOL]: {
        key: options.mutationKey,
        type: 'mutation',
      },
    } })
  })
})

describe('createProcedureUtils with defaults', () => {
  const client = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('.queryKey', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          queryKey: { input: { defaultInput: true } },
        },
      })

      utils.queryKey()

      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { defaultInput: true } })
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          queryKey: { input: { defaultInput: true } },
        },
      })

      utils.queryKey({ input: { userInput: true } })

      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { userInput: true } })
    })

    it('custom queryKey overrides default', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          queryKey: { queryKey: ['default-key'] },
        },
      })

      expect(utils.queryKey()).toEqual(['default-key'])
      expect(utils.queryKey({ queryKey: ['user-key'] })).toEqual(['user-key'])
    })
  })

  describe('.queryOptions', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          queryOptions: { input: { defaultInput: true }, staleTime: 1000 },
        },
      })

      const options = utils.queryOptions() as any

      expect(options.staleTime).toBe(1000)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { defaultInput: true } })
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          queryOptions: { input: { defaultInput: true }, staleTime: 1000 },
        },
      })

      const options = utils.queryOptions({ input: { userInput: true }, staleTime: 2000 }) as any

      expect(options.staleTime).toBe(2000)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { userInput: true } })
    })
  })

  describe('.experimental_streamedKey', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_streamedKey: { input: { defaultInput: true } },
        },
      })

      utils.experimental_streamedKey()

      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'streamed', input: { defaultInput: true } })
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_streamedKey: { input: { defaultInput: true } },
        },
      })

      utils.experimental_streamedKey({ input: { userInput: true } })

      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'streamed', input: { userInput: true } })
    })
  })

  describe('.experimental_streamedOptions', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_streamedOptions: { input: { defaultInput: true }, staleTime: 1000 },
        },
      })

      const options = utils.experimental_streamedOptions() as any

      expect(options.staleTime).toBe(1000)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'streamed', input: { defaultInput: true } })
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_streamedOptions: { input: { defaultInput: true }, staleTime: 1000 },
        },
      })

      const options = utils.experimental_streamedOptions({ input: { userInput: true }, staleTime: 2000 }) as any

      expect(options.staleTime).toBe(2000)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'streamed', input: { userInput: true } })
    })
  })

  describe('.experimental_liveKey', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_liveKey: { input: { defaultInput: true } },
        },
      })

      utils.experimental_liveKey()

      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'live', input: { defaultInput: true } })
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_liveKey: { input: { defaultInput: true } },
        },
      })

      utils.experimental_liveKey({ input: { userInput: true } })

      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'live', input: { userInput: true } })
    })
  })

  describe('.experimental_liveOptions', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_liveOptions: { input: { defaultInput: true }, staleTime: 1000 },
        },
      })

      const options = utils.experimental_liveOptions() as any

      expect(options.staleTime).toBe(1000)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'live', input: { defaultInput: true } })
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          experimental_liveOptions: { input: { defaultInput: true }, staleTime: 1000 },
        },
      })

      const options = utils.experimental_liveOptions({ input: { userInput: true }, staleTime: 2000 }) as any

      expect(options.staleTime).toBe(2000)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'live', input: { userInput: true } })
    })
  })

  describe('.infiniteKey', () => {
    it('applies defaults when options provided', () => {
      const defaultInput = vi.fn().mockReturnValue({ defaultInput: true })
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          infiniteKey: { input: defaultInput, initialPageParam: 0 },
        },
      })

      utils.infiniteKey({ input: () => ({}), initialPageParam: 1 })

      // User options override defaults
      expect(defaultInput).not.toHaveBeenCalled()
    })

    it('custom queryKey in defaults is used', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          infiniteKey: { queryKey: ['default-infinite-key'] },
        },
      })

      expect(utils.infiniteKey({ input: () => ({}), initialPageParam: 0 })).toEqual(['default-infinite-key'])
    })
  })

  describe('.infiniteOptions', () => {
    it('applies defaults', () => {
      const getNextPageParam = vi.fn()
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          infiniteOptions: { staleTime: 1000 },
        },
      })

      const options = utils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam: 0,
      }) as any

      expect(options.staleTime).toBe(1000)
    })

    it('user options override defaults', () => {
      const getNextPageParam = vi.fn()
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          infiniteOptions: { staleTime: 1000 },
        },
      })

      const options = utils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam: 0,
        staleTime: 2000,
      }) as any

      expect(options.staleTime).toBe(2000)
    })
  })

  describe('.mutationKey', () => {
    it('applies defaults when no options provided', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          mutationKey: { mutationKey: ['default-mutation-key'] },
        },
      })

      expect(utils.mutationKey()).toEqual(['default-mutation-key'])
    })

    it('user options override defaults', () => {
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          mutationKey: { mutationKey: ['default-mutation-key'] },
        },
      })

      expect(utils.mutationKey({ mutationKey: ['user-mutation-key'] })).toEqual(['user-mutation-key'])
    })
  })

  describe('.mutationOptions', () => {
    it('applies defaults when no options provided', () => {
      const onSuccess = vi.fn()
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          mutationOptions: { onSuccess },
        },
      })

      const options = utils.mutationOptions()

      expect(options.onSuccess).toBe(onSuccess)
    })

    it('user options override defaults', () => {
      const defaultOnSuccess = vi.fn()
      const userOnSuccess = vi.fn()
      const utils = createProcedureUtils(client, {
        path: ['ping'],
        experimental_defaults: {
          mutationOptions: { onSuccess: defaultOnSuccess },
        },
      })

      const options = utils.mutationOptions({ onSuccess: userOnSuccess })

      expect(options.onSuccess).toBe(userOnSuccess)
    })
  })
})
