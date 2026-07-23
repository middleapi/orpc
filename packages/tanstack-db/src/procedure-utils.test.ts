import { generateOperationKey, TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL } from '@orpc/tanstack-query'
import { QueryClient } from '@tanstack/query-core'
import * as QueryDBCollectionModule from '@tanstack/query-db-collection'
import { ProcedureUtils } from './procedure-utils'

vi.mock('@tanstack/query-db-collection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/query-db-collection')>()

  return {
    ...actual,
    queryCollectionOptions: vi.fn(actual.queryCollectionOptions),
  }
})

const queryCollectionOptionsSpy = vi.mocked(QueryDBCollectionModule.queryCollectionOptions)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('procedureUtils', () => {
  const signal = new AbortController().signal
  const client = vi.fn()
  const utils = new ProcedureUtils(['planet', 'list'], client as any)

  it('.call', () => {
    expect(utils.call).toBe(client)
  })

  describe('.collectionOptions', () => {
    const queryClient = new QueryClient()
    const getKey = vi.fn((item: any) => item.id)

    it('forwards options to queryCollectionOptions with a generated queryKey builder', () => {
      const inputFn = vi.fn((options: any) => ({ search: '__search__', limit: options.limit }))

      const options = utils.collectionOptions({
        input: inputFn,
        queryClient,
        getKey,
        startSync: true,
      } as any)

      expect(queryCollectionOptionsSpy).toHaveBeenCalledTimes(1)
      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any
      inputFn.mockClear()

      expect(config.queryKey({})).toEqual(
        generateOperationKey(['planet', 'list'], { type: 'query', input: { search: '__search__', limit: undefined } }),
      )
      expect(config.queryKey({ limit: 5 })).toEqual(
        generateOperationKey(['planet', 'list'], { type: 'query', input: { search: '__search__', limit: 5 } }),
      )
      expect(inputFn).toHaveBeenNthCalledWith(1, {})
      expect(inputFn).toHaveBeenNthCalledWith(2, { limit: 5 })

      expect(config.queryClient).toBe(queryClient)
      expect(config.getKey).toBe(getKey)
      expect(config.startSync).toBe(true)
      expect(config).not.toHaveProperty('input')
      expect(config).not.toHaveProperty('context')

      expect(options).toBe(queryCollectionOptionsSpy.mock.results[0]!.value)
    })

    it('queryFn resolves input from loadSubsetOptions & context from its context', async () => {
      client.mockResolvedValueOnce([{ id: 1 }])

      const inputFn = vi.fn((options: any) => ({ limit: options.limit }))
      const contextFn = vi.fn(() => ({ cache: true }))

      utils.collectionOptions({
        input: inputFn,
        context: contextFn,
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any
      const queryKey = config.queryKey({ limit: 5 })
      inputFn.mockClear()

      const fnContext = { signal, queryKey, meta: { loadSubsetOptions: { limit: 5 } } }
      await expect(config.queryFn(fnContext)).resolves.toEqual([{ id: 1 }])

      expect(inputFn).toHaveBeenCalledTimes(1)
      expect(inputFn).toHaveBeenCalledWith({ limit: 5 })
      expect(contextFn).toHaveBeenCalledTimes(1)
      expect(contextFn).toHaveBeenCalledWith(fnContext)

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ limit: 5 }, {
        signal,
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: queryKey,
            type: 'query',
          },
          cache: true,
        },
      })
    })

    it('supports custom queryKey', () => {
      utils.collectionOptions({
        input: () => ({ search: '__search__' }),
        queryKey: ['__custom__'],
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any
      expect(config.queryKey).toEqual(['__custom__'])
    })

    it('supports custom queryFn', async () => {
      const customQueryFn = vi.fn(async () => [{ id: 1 }])

      utils.collectionOptions({
        input: () => ({ search: '__search__' }),
        queryFn: customQueryFn,
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any
      expect(config.queryFn).toBe(customQueryFn)

      await expect(config.queryFn({ signal })).resolves.toEqual([{ id: 1 }])
      expect(client).not.toHaveBeenCalled()
    })

    it('works without input & context', async () => {
      client.mockResolvedValueOnce([{ id: 1 }])

      utils.collectionOptions({
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any

      const queryKey = config.queryKey({})
      expect(queryKey).toEqual(generateOperationKey(['planet', 'list'], { type: 'query' }))

      await expect(config.queryFn({ signal, queryKey })).resolves.toEqual([{ id: 1 }])

      expect(client).toHaveBeenCalledWith(undefined, {
        signal,
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: queryKey,
            type: 'query',
          },
        },
      })
    })

    it('includes prefix in generated queryKey', () => {
      const prefixedUtils = new ProcedureUtils(['planet', 'list'], client as any, { prefix: '__prefix__' })

      prefixedUtils.collectionOptions({
        input: () => ({ search: '__search__' }),
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any
      expect(config.queryKey({})).toEqual(
        generateOperationKey(['planet', 'list'], { prefix: '__prefix__', type: 'query', input: { search: '__search__' } }),
      )
    })
  })

  describe('.mutationHandler', () => {
    const params = {
      transaction: {
        mutations: [
          { type: 'update', key: 1, modified: { id: 1, name: '__modified1__' }, changes: { name: '__modified1__' } },
          { type: 'update', key: 2, modified: { id: 2, name: '__modified2__' }, changes: { name: '__modified2__' } },
        ],
      },
      collection: {},
    } as any

    it('calls client once per mutation and resolves undefined without refetch option', async () => {
      client.mockResolvedValueOnce('__output1__').mockResolvedValueOnce('__output2__')

      const inputMapper = vi.fn((mutation: any) => ({ id: mutation.key, data: mutation.changes }))
      const handler = utils.mutationHandler({ input: inputMapper } as any)

      await expect(handler(params)).resolves.toBeUndefined()

      expect(inputMapper).toHaveBeenCalledTimes(2)
      expect(inputMapper).toHaveBeenNthCalledWith(1, params.transaction.mutations[0], params)
      expect(inputMapper).toHaveBeenNthCalledWith(2, params.transaction.mutations[1], params)

      expect(client).toHaveBeenCalledTimes(2)
      expect(client).toHaveBeenNthCalledWith(1, { id: 1, data: { name: '__modified1__' } }, {
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: generateOperationKey(['planet', 'list'], { type: 'mutation' }),
            type: 'mutation',
          },
        },
      })
      expect(client).toHaveBeenNthCalledWith(2, { id: 2, data: { name: '__modified2__' } }, expect.any(Object))
    })

    it('calls client concurrently', async () => {
      let resolveFirst!: (value: string) => void
      client.mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      client.mockResolvedValueOnce('__output2__')

      const handler = utils.mutationHandler({ input: (mutation: any) => mutation.key } as any)
      const promise = handler(params)

      expect(client).toHaveBeenCalledTimes(2)

      resolveFirst('__output1__')
      await expect(promise).resolves.toBeUndefined()
    })

    it('supports static refetch option', async () => {
      client.mockResolvedValueOnce('__output1__').mockResolvedValueOnce('__output2__')

      const handler = utils.mutationHandler({
        input: (mutation: any) => mutation.modified,
        refetch: false,
      } as any)

      await expect(handler(params)).resolves.toEqual({ refetch: false })
    })

    it('supports dynamic refetch option', async () => {
      client.mockResolvedValueOnce('__output1__').mockResolvedValueOnce('__output2__')

      const refetchFn = vi.fn((outputs: any[]) => outputs.length > 2)
      const handler = utils.mutationHandler({
        input: (mutation: any) => mutation.modified,
        refetch: refetchFn,
      } as any)

      await expect(handler(params)).resolves.toEqual({ refetch: false })
      expect(refetchFn).toHaveBeenCalledTimes(1)
      expect(refetchFn).toHaveBeenCalledWith(['__output1__', '__output2__'], params)
    })

    it('resolves context per mutation and includes prefix in mutation key', async () => {
      const prefixedUtils = new ProcedureUtils(['planet', 'list'], client as any, { prefix: '__prefix__' })
      client.mockResolvedValueOnce('__output1__').mockResolvedValueOnce('__output2__')

      const contextFn = vi.fn((mutation: any) => ({ cache: mutation.key }))

      const handler = prefixedUtils.mutationHandler({
        input: (mutation: any) => mutation.key,
        context: contextFn,
      } as any)

      await handler(params)

      expect(contextFn).toHaveBeenCalledTimes(2)
      expect(contextFn).toHaveBeenNthCalledWith(1, params.transaction.mutations[0], params)
      expect(contextFn).toHaveBeenNthCalledWith(2, params.transaction.mutations[1], params)

      expect(client).toHaveBeenNthCalledWith(1, 1, {
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: generateOperationKey(['planet', 'list'], { prefix: '__prefix__', type: 'mutation' }),
            type: 'mutation',
          },
          cache: 1,
        },
      })
      expect(client).toHaveBeenNthCalledWith(2, 2, {
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: generateOperationKey(['planet', 'list'], { prefix: '__prefix__', type: 'mutation' }),
            type: 'mutation',
          },
          cache: 2,
        },
      })
    })

    it('works without options', async () => {
      client.mockResolvedValueOnce('__output1__').mockResolvedValueOnce('__output2__')

      const handler = utils.mutationHandler()

      await expect(handler(params)).resolves.toBeUndefined()
      expect(client).toHaveBeenNthCalledWith(1, undefined, expect.any(Object))
    })
  })
})
