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

    it('forwards options to queryCollectionOptions with a generated queryKey', () => {
      const options = utils.collectionOptions({
        input: () => ({ search: '__search__' }),
        queryClient,
        getKey,
        startSync: true,
      } as any)

      expect(queryCollectionOptionsSpy).toHaveBeenCalledTimes(1)
      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any

      expect(config.queryKey).toEqual(generateOperationKey(['planet', 'list'], { type: 'query' }))
      expect(config.queryClient).toBe(queryClient)
      expect(config.getKey).toBe(getKey)
      expect(config.startSync).toBe(true)
      expect(config).not.toHaveProperty('input')
      expect(config).not.toHaveProperty('context')

      expect(options).toBe(queryCollectionOptionsSpy.mock.results[0]!.value)
    })

    it('queryFn resolves input & context from its context and calls client', async () => {
      client.mockResolvedValueOnce([{ id: 1 }])

      const inputFn = vi.fn((fnContext: any) => ({ search: fnContext.queryKey[1].search }))
      const contextFn = vi.fn(() => ({ cache: true }))

      utils.collectionOptions({
        input: inputFn,
        context: contextFn,
        queryKey: ['__custom__', { search: '__dynamic__' }],
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any

      expect(config.queryKey).toEqual(['__custom__', { search: '__dynamic__' }])

      await expect(config.queryFn({ signal, queryKey: config.queryKey })).resolves.toEqual([{ id: 1 }])

      expect(inputFn).toHaveBeenCalledTimes(1)
      expect(inputFn).toHaveBeenCalledWith({ signal, queryKey: config.queryKey })
      expect(contextFn).toHaveBeenCalledTimes(1)
      expect(contextFn).toHaveBeenCalledWith({ signal, queryKey: config.queryKey })

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__dynamic__' }, {
        signal,
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: config.queryKey,
            type: 'query',
          },
          cache: true,
        },
      })
    })

    it('works without input & context', async () => {
      client.mockResolvedValueOnce([{ id: 1 }])

      utils.collectionOptions({
        queryClient,
        getKey,
      } as any)

      const config = queryCollectionOptionsSpy.mock.calls[0]![0] as any

      await expect(config.queryFn({ signal, queryKey: config.queryKey })).resolves.toEqual([{ id: 1 }])

      expect(client).toHaveBeenCalledWith(undefined, {
        signal,
        context: {
          [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
            key: config.queryKey,
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
      expect(config.queryKey).toEqual(
        generateOperationKey(['planet', 'list'], { prefix: '__prefix__', type: 'query' }),
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

    it('calls client once per mutation and resolves undefined without output mapper', async () => {
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

    it('calls client sequentially', async () => {
      let resolveFirst!: (value: string) => void
      client.mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      client.mockResolvedValueOnce('__output2__')

      const handler = utils.mutationHandler({ input: (mutation: any) => mutation.key } as any)
      const promise = handler(params)

      await new Promise(resolve => setTimeout(resolve, 10))
      expect(client).toHaveBeenCalledTimes(1)

      resolveFirst('__output1__')
      await expect(promise).resolves.toBeUndefined()
      expect(client).toHaveBeenCalledTimes(2)
    })

    it('supports output mapper', async () => {
      client.mockResolvedValueOnce({ txid: 1 }).mockResolvedValueOnce({ txid: 2 })

      const outputMapper = vi.fn((outputs: any[]) => ({ txid: outputs.map(output => output.txid) }))
      const handler = utils.mutationHandler({
        input: (mutation: any) => mutation.modified,
        output: outputMapper,
      } as any)

      await expect(handler(params)).resolves.toEqual({ txid: [1, 2] })
      expect(outputMapper).toHaveBeenCalledTimes(1)
      expect(outputMapper).toHaveBeenCalledWith([{ txid: 1 }, { txid: 2 }], params)
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
