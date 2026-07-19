import * as KeyModule from './key'
import { ProcedureUtils } from './procedure-utils'
import { OPERATION_CONTEXT_SYMBOL } from './types'

const buildKeySpy = vi.spyOn(KeyModule, 'buildKey')

const signal = new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
})

describe('procedureUtils', () => {
  const client = vi.fn()
  const utils = new ProcedureUtils(['ping'], client)

  it('.call', () => {
    expect(utils.call).toBe(client)
  })

  describe('.queryOptions', () => {
    it('works', async () => {
      const options = utils.queryOptions({ input: 1 }) as any

      expect(options.key).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: 1 })

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith(1, { signal, context: {
        [OPERATION_CONTEXT_SYMBOL]: {
          key: options.key,
          type: 'query',
        },
      } })
    })

    it('works without options', async () => {
      const options = utils.queryOptions() as any

      expect(options.key).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: undefined })

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith(undefined, { signal, context: {
        [OPERATION_CONTEXT_SYMBOL]: {
          key: options.key,
          type: 'query',
        },
      } })
    })

    it('works with client context', async () => {
      const options = utils.queryOptions({ context: { batch: true } }) as any

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith(undefined, { signal, context: {
        batch: true,
        [OPERATION_CONTEXT_SYMBOL]: {
          key: options.key,
          type: 'query',
        },
      } })
    })

    it('passes rest options through', () => {
      const options = utils.queryOptions({ input: 1, staleTime: 1000 }) as any

      expect(options.staleTime).toEqual(1000)
    })

    it('respects user provided key', async () => {
      const options = utils.queryOptions({ key: ['__custom__'] } as any) as any

      expect(options.key).toEqual(['__custom__'])
      expect(buildKeySpy).toHaveBeenCalledTimes(0)

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.query({ signal })).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledWith(undefined, { signal, context: {
        [OPERATION_CONTEXT_SYMBOL]: {
          key: ['__custom__'],
          type: 'query',
        },
      } })
    })

    it('uses custom query instead of client but still runs interceptors', async () => {
      const interceptor = vi.fn(({ next }) => next())
      const interceptedUtils = new ProcedureUtils(['ping'], client, { queryInterceptors: [interceptor] })

      const query = vi.fn().mockResolvedValue('__custom__')
      const fnContext = { signal } as any
      const options = interceptedUtils.queryOptions({ query } as any) as any

      await expect(options.query(fnContext)).resolves.toEqual('__custom__')
      expect(interceptor).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith(fnContext)
      expect(client).toHaveBeenCalledTimes(0)
    })

    it('runs interceptors in order & allows overriding options', async () => {
      const interceptor1 = vi.fn(({ next }) => next())
      const interceptor2 = vi.fn(options => options.next({
        ...options,
        input: '__override__',
        context: { ...options.context, extra: true },
      }))

      const interceptedUtils = new ProcedureUtils(['ping'], client, {
        queryInterceptors: [interceptor1, interceptor2],
      })

      const options = interceptedUtils.queryOptions({ input: 1, context: { batch: true } } as any) as any
      const fnContext = { signal } as any

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.query(fnContext)).resolves.toEqual('__mocked__')

      expect(interceptor1).toHaveBeenCalledTimes(1)
      expect(interceptor1).toHaveBeenCalledWith(expect.objectContaining({
        path: ['ping'],
        input: 1,
        fnContext,
        context: {
          batch: true,
          [OPERATION_CONTEXT_SYMBOL]: {
            key: options.key,
            type: 'query',
          },
        },
      }))
      expect(interceptor2).toHaveBeenCalledTimes(1)
      expect(interceptor1.mock.invocationCallOrder[0]!).toBeLessThan(interceptor2.mock.invocationCallOrder[0]!)

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith('__override__', { signal, context: {
        batch: true,
        extra: true,
        [OPERATION_CONTEXT_SYMBOL]: {
          key: options.key,
          type: 'query',
        },
      } })
    })

    it('applies object modifier with per-call options taking precedence', () => {
      const modifiedUtils = new ProcedureUtils(['ping'], client, {
        queryOptions: { staleTime: 1000, gcTime: 500 } as any,
      })

      const options = modifiedUtils.queryOptions({ staleTime: 2000 } as any) as any

      expect(options.staleTime).toEqual(2000)
      expect(options.gcTime).toEqual(500)
    })

    it('applies function modifier', () => {
      const modifier = vi.fn((options: any) => ({ ...options, staleTime: 3000 }))
      const modifiedUtils = new ProcedureUtils(['ping'], client, {
        queryOptions: modifier,
      })

      const options = modifiedUtils.queryOptions({ input: 1 } as any) as any

      expect(modifier).toHaveBeenCalledTimes(1)
      expect(modifier).toHaveBeenCalledWith({ input: 1 })
      expect(options.staleTime).toEqual(3000)
    })
  })

  describe('.mutationOptions', () => {
    it('works', async () => {
      const options = utils.mutationOptions() as any

      expect(options.key('__input__')).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation', input: '__input__' })

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.mutation(1, {})).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith(1, { context: {
        [OPERATION_CONTEXT_SYMBOL]: {
          key: buildKeySpy.mock.results[1]!.value,
          type: 'mutation',
        },
      } })
      expect(buildKeySpy).toHaveBeenNthCalledWith(2, ['ping'], { type: 'mutation', input: 1 })
    })

    it('works with client context', async () => {
      const options = utils.mutationOptions({ context: { batch: true } }) as any

      expect(options.key('__input__')).toBe(buildKeySpy.mock.results[0]!.value)
      expect(buildKeySpy).toHaveBeenCalledTimes(1)
      expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation', input: '__input__' })

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.mutation(1, {})).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith(1, { context: {
        batch: true,
        [OPERATION_CONTEXT_SYMBOL]: {
          key: buildKeySpy.mock.results[1]!.value,
          type: 'mutation',
        },
      } })
    })

    it('passes rest options through', () => {
      const onSuccess = vi.fn()
      const options = utils.mutationOptions({ onSuccess }) as any

      expect(options.onSuccess).toBe(onSuccess)
    })

    it('respects user provided key', async () => {
      const options = utils.mutationOptions({ key: ['__custom__'] } as any) as any

      expect(options.key).toEqual(['__custom__'])
      expect(buildKeySpy).toHaveBeenCalledTimes(0)

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.mutation(1, {})).resolves.toEqual('__mocked__')
      expect(client).toHaveBeenCalledWith(1, { context: {
        [OPERATION_CONTEXT_SYMBOL]: {
          key: ['__custom__'],
          type: 'mutation',
        },
      } })
    })

    it('uses custom mutation instead of client but still runs interceptors', async () => {
      const interceptor = vi.fn(({ next }) => next())
      const interceptedUtils = new ProcedureUtils(['ping'], client, { mutationInterceptors: [interceptor] })

      const mutation = vi.fn().mockResolvedValue('__custom__')
      const fnContext = {} as any
      const options = interceptedUtils.mutationOptions({ mutation } as any) as any

      await expect(options.mutation(1, fnContext)).resolves.toEqual('__custom__')
      expect(interceptor).toHaveBeenCalledTimes(1)
      expect(mutation).toHaveBeenCalledTimes(1)
      expect(mutation).toHaveBeenCalledWith(1, fnContext)
      expect(client).toHaveBeenCalledTimes(0)
    })

    it('runs interceptors in order & allows overriding options', async () => {
      const interceptor1 = vi.fn(({ next }) => next())
      const interceptor2 = vi.fn(options => options.next({
        ...options,
        input: '__override__',
      }))

      const interceptedUtils = new ProcedureUtils(['ping'], client, {
        mutationInterceptors: [interceptor1, interceptor2],
      })

      const options = interceptedUtils.mutationOptions({ context: { batch: true } } as any) as any
      const fnContext = {} as any

      client.mockResolvedValueOnce('__mocked__')
      await expect(options.mutation(1, fnContext)).resolves.toEqual('__mocked__')

      expect(interceptor1).toHaveBeenCalledTimes(1)
      expect(interceptor1).toHaveBeenCalledWith(expect.objectContaining({
        path: ['ping'],
        input: 1,
        fnContext,
        context: {
          batch: true,
          [OPERATION_CONTEXT_SYMBOL]: {
            key: buildKeySpy.mock.results[0]!.value,
            type: 'mutation',
          },
        },
      }))
      expect(interceptor2).toHaveBeenCalledTimes(1)
      expect(interceptor1.mock.invocationCallOrder[0]!).toBeLessThan(interceptor2.mock.invocationCallOrder[0]!)

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith('__override__', { context: {
        batch: true,
        [OPERATION_CONTEXT_SYMBOL]: {
          key: buildKeySpy.mock.results[0]!.value,
          type: 'mutation',
        },
      } })
    })

    it('applies object modifier with per-call options taking precedence', () => {
      const modifiedUtils = new ProcedureUtils(['ping'], client, {
        mutationOptions: { gcTime: 500, meta: { a: 1 } } as any,
      })

      const options = modifiedUtils.mutationOptions({ gcTime: 1000 } as any) as any

      expect(options.gcTime).toEqual(1000)
      expect(options.meta).toEqual({ a: 1 })
    })

    it('applies function modifier', () => {
      const modifier = vi.fn((options: any) => ({ ...options, gcTime: 3000 }))
      const modifiedUtils = new ProcedureUtils(['ping'], client, {
        mutationOptions: modifier,
      })

      const onSuccess = vi.fn()
      const options = modifiedUtils.mutationOptions({ onSuccess } as any) as any

      expect(modifier).toHaveBeenCalledTimes(1)
      expect(modifier).toHaveBeenCalledWith({ onSuccess })
      expect(options.gcTime).toEqual(3000)
    })
  })
})
