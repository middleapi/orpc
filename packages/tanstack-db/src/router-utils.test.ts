import { generateOperationKey } from '@orpc/tanstack-query'
import { ProcedureUtils } from './procedure-utils'
import { createRouterUtils } from './router-utils'

vi.mock('./procedure-utils', async () => ({
  ProcedureUtils: vi.fn(class {
    call = vi.fn()
    collectionOptions = vi.fn(() => ({ collectionOptions: true }))
    mutationHandler = vi.fn(() => ({ mutationHandler: true }))
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRouterUtils', () => {
  const client = vi.fn() as any
  client.key = vi.fn() // "key" mean client can handle when client and method is conflict
  client.key.pong = vi.fn()

  it('create nested procedure & shared utils', () => {
    const utils = createRouterUtils(client, { prefix: '__prefix__' }) as any

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith([], client, { prefix: '__prefix__' })
    expect(utils.key({ type: 'query' })).toEqual(generateOperationKey([], { type: 'query', prefix: '__prefix__' }))
    expect(utils.collectionOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.collectionOptions.mock.results[0]?.value)

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key'], client.key, { prefix: '__prefix__' })
    expect(keyUtils.key({ type: 'query' })).toEqual(generateOperationKey(['key'], { type: 'query', prefix: '__prefix__' }))
    expect(keyUtils.collectionOptions()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.collectionOptions.mock.results[0]?.value)

    vi.clearAllMocks()
    const pongUtils = keyUtils.pong

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['key', 'pong'], client.key.pong, { prefix: '__prefix__' })
    expect(pongUtils.key({ type: 'mutation' })).toEqual(generateOperationKey(['key', 'pong'], { type: 'mutation', prefix: '__prefix__' }))
    expect(pongUtils.mutationHandler()).toBe(vi.mocked(ProcedureUtils).mock.results[0]?.value.mutationHandler.mock.results[0]?.value)
  })

  it('roots utils at the given base path', () => {
    const utils = createRouterUtils(client, { path: ['__base__'] }) as any

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['__base__'], client, { prefix: undefined })
    expect(utils.key({ type: 'query' })).toEqual(generateOperationKey(['__base__'], { type: 'query' }))

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(ProcedureUtils).toHaveBeenCalledTimes(1)
    expect(ProcedureUtils).toHaveBeenCalledWith(['__base__', 'key'], client.key, { prefix: undefined })
    expect(keyUtils.key({ type: 'query' })).toEqual(generateOperationKey(['__base__', 'key'], { type: 'query' }))
  })

  it('stops recursive on symbol', async () => {
    const utils = createRouterUtils(client) as any
    expect(utils[Symbol.for('a')]).toBe(undefined)
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
