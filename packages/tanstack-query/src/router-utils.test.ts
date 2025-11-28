import * as generalUtilsModule from './general-utils'
import * as procedureUtilsModule from './procedure-utils'
import { createRouterUtils } from './router-utils'

const procedureUtilsSpy = vi.spyOn(procedureUtilsModule, 'createProcedureUtils')
const generalUtilsSpy = vi.spyOn(generalUtilsModule, 'createGeneralUtils')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRouterUtils', () => {
  const client = vi.fn() as any
  client.key = vi.fn() // "key" mean client can handle when client and method is conflict
  client.key.pong = vi.fn()

  it('works', () => {
    const utils = createRouterUtils(client, {
      path: ['__base__'],
    }) as any

    expect(generalUtilsSpy).toHaveBeenCalledTimes(1)
    expect(generalUtilsSpy).toHaveBeenCalledWith(['__base__'])
    expect(procedureUtilsSpy).toHaveBeenCalledTimes(1)
    expect(procedureUtilsSpy).toHaveBeenCalledWith(client, { path: ['__base__'] })

    expect(utils.key()).toEqual(generalUtilsSpy.mock.results[0]!.value.key())
    expect(utils.queryOptions().queryKey).toEqual(procedureUtilsSpy.mock.results[0]!.value.queryOptions().queryKey)

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(generalUtilsSpy).toHaveBeenCalledTimes(1)
    expect(generalUtilsSpy).toHaveBeenCalledWith(['__base__', 'key'])
    expect(procedureUtilsSpy).toHaveBeenCalledTimes(1)
    expect(procedureUtilsSpy).toHaveBeenCalledWith(client.key, { path: ['__base__', 'key'] })

    expect(keyUtils.key()).toEqual(generalUtilsSpy.mock.results[0]!.value.key())
    expect(keyUtils.queryOptions().queryKey).toEqual(procedureUtilsSpy.mock.results[0]!.value.queryOptions().queryKey)

    vi.clearAllMocks()
    const pongUtils = utils.key.pong

    expect(generalUtilsSpy).toHaveBeenCalledTimes(2)
    expect(generalUtilsSpy).toHaveBeenNthCalledWith(1, ['__base__', 'key'])
    expect(generalUtilsSpy).toHaveBeenNthCalledWith(2, ['__base__', 'key', 'pong'])

    expect(procedureUtilsSpy).toHaveBeenCalledTimes(2)
    expect(procedureUtilsSpy).toHaveBeenNthCalledWith(1, client.key, { path: ['__base__', 'key'] })
    expect(procedureUtilsSpy).toHaveBeenNthCalledWith(2, client.key.pong, { path: ['__base__', 'key', 'pong'] })

    expect(pongUtils.key()).toEqual(generalUtilsSpy.mock.results[1]!.value.key())
    expect(pongUtils.queryOptions().queryKey).toEqual(procedureUtilsSpy.mock.results[1]!.value.queryOptions().queryKey)
  })

  it('not recursive on symbol', async () => {
    const utils = createRouterUtils(client) as any
    expect(utils[Symbol.for('a')]).toBe(undefined)
  })

  it('with defaults', () => {
    const keyDefaults = {
      queryOptions: {
        staleTime: 1000,
      },
      mutationOptions: {
        context: { foo: 'bar' },
      },
    }

    const utils = createRouterUtils(client, {
      experimental_defaults: {
        key: keyDefaults,
      },
    }) as any

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(procedureUtilsSpy).toHaveBeenCalledWith(client.key, {
      path: ['key'],
      experimental_defaults: keyDefaults,
    })
    expect(keyUtils.queryOptions().staleTime).toBeDefined()

    vi.clearAllMocks()
    const pongUtils = keyUtils.pong

    expect(procedureUtilsSpy).toHaveBeenCalledWith(client.key.pong, {
      path: ['key', 'pong'],
    })
    expect(pongUtils.queryOptions().staleTime).not.toBeDefined()
  })
})
