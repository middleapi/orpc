import * as keyModule from './key'
import { createProcedureUtils } from './utils-procedure'

const buildKeySpy = vi.spyOn(keyModule, 'buildKey')

const controller = new AbortController()
const signal = controller.signal

beforeEach(() => {
  buildKeySpy.mockClear()
})

describe('queryOptions', () => {
  const client = vi.fn((...[input]) => Promise.resolve(input?.toString()))
  const utils = createProcedureUtils(client, ['ping'])

  it('works', async () => {
    const options = utils.queryOptions({ input: 1 })

    expect(options.queryKey).toEqual(['__ORPC__', ['ping'], { type: 'query', input: 1 }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: 1 })

    client.mockResolvedValueOnce('__mocked__')
    await expect((options as any).queryFn({ signal })).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith(1, { signal })
  })

  it('works with client context', async () => {
    const client = vi.fn((...[input]) => Promise.resolve(input?.toString()))
    const utils = createProcedureUtils(client, ['ping'])

    const options = utils.queryOptions({ context: { batch: true } })

    expect(options.queryKey).toEqual(['__ORPC__', ['ping'], { type: 'query' }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query' })

    client.mockResolvedValueOnce('__mocked__')
    await expect((options as any).queryFn({ signal })).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith(undefined, { signal, context: { batch: true } })
  })
})

describe('infiniteOptions', () => {
  const getNextPageParam = vi.fn()

  it('works ', async () => {
    const client = vi.fn()
    const utils = createProcedureUtils(client, [])

    const options = utils.infiniteOptions({
      input: { limit: 5 },
      getNextPageParam,
      initialPageParam: 1,
    })

    expect(options.initialPageParam).toEqual(1)
    expect(options.queryKey).toEqual(['__ORPC__', [], { type: 'infinite', input: { limit: 5 } }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith([], { type: 'infinite', input: { limit: 5 } })

    client.mockResolvedValueOnce('__mocked__')
    await expect((options as any).queryFn({ pageParam: 1, signal })).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith({ limit: 5, cursor: 1 }, { signal })
  })

  it('works without initialPageParam', async () => {
    const client = vi.fn()
    const utils = createProcedureUtils(client, [])

    const options = utils.infiniteOptions({
      input: { limit: 5 },
      getNextPageParam,
    })

    expect(options.queryKey).toEqual(['__ORPC__', [], { type: 'infinite', input: { limit: 5 } }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith([], { type: 'infinite', input: { limit: 5 } })

    client.mockResolvedValueOnce('__mocked__')
    await expect((options as any).queryFn({ pageParam: undefined, signal })).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith({ limit: 5, cursor: undefined }, { signal })
  })

  it('works with client context', async () => {
    const client = vi.fn()
    const utils = createProcedureUtils(client, [])

    const options = utils.infiniteOptions({
      context: { batch: true },
      getNextPageParam,
      initialPageParam: 1,
    })

    expect(options.queryKey).toEqual(['__ORPC__', [], { type: 'infinite' }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith([], { type: 'infinite' })

    client.mockResolvedValueOnce('__mocked__')
    await expect((options as any).queryFn({ pageParam: 1, signal })).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith({ limit: undefined, cursor: 1 }, { signal, context: { batch: true } })
  })
})

describe('mutationOptions', () => {
  it('works', async () => {
    const client = vi.fn(
      (...[input]) => Promise.resolve(input?.toString()),
    )
    const utils = createProcedureUtils(client, ['ping'])

    const options = utils.mutationOptions()

    expect(options.mutationKey).toEqual(['__ORPC__', ['ping'], { type: 'mutation' }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation' })

    client.mockResolvedValueOnce('__mocked__')
    await expect(options.mutationFn(1)).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith(1, {})
  })

  it('works with client context', async () => {
    const client = vi.fn(
      (...[input]) => Promise.resolve(input?.toString()),
    )
    const utils = createProcedureUtils(client, ['ping'])

    const options = utils.mutationOptions({ context: { batch: true } })

    expect(options.mutationKey).toEqual(['__ORPC__', ['ping'], { type: 'mutation' }])
    expect(buildKeySpy).toHaveBeenCalledTimes(1)
    expect(buildKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation' })

    client.mockResolvedValueOnce('__mocked__')
    await expect(options.mutationFn(1)).resolves.toEqual('__mocked__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith(1, { context: { batch: true } })
  })
})
