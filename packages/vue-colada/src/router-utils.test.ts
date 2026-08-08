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
    expect(utils.queryOptions().key.value).toEqual(procedureUtilsSpy.mock.results[0]!.value.queryOptions().key.value)

    vi.clearAllMocks()
    const keyUtils = utils.key

    expect(generalUtilsSpy).toHaveBeenCalledTimes(1)
    expect(generalUtilsSpy).toHaveBeenCalledWith(['__base__', 'key'])
    expect(procedureUtilsSpy).toHaveBeenCalledTimes(1)
    expect(procedureUtilsSpy).toHaveBeenCalledWith(client.key, { path: ['__base__', 'key'] })

    expect(keyUtils.key()).toEqual(generalUtilsSpy.mock.results[0]!.value.key())
    expect(keyUtils.queryOptions().key.value).toEqual(procedureUtilsSpy.mock.results[0]!.value.queryOptions().key.value)

    vi.clearAllMocks()
    const pongUtils = utils.key.pong

    expect(generalUtilsSpy).toHaveBeenCalledTimes(2)
    expect(generalUtilsSpy).toHaveBeenNthCalledWith(1, ['__base__', 'key'])
    expect(generalUtilsSpy).toHaveBeenNthCalledWith(2, ['__base__', 'key', 'pong'])

    expect(procedureUtilsSpy).toHaveBeenCalledTimes(2)
    expect(procedureUtilsSpy).toHaveBeenNthCalledWith(1, client.key, { path: ['__base__', 'key'] })
    expect(procedureUtilsSpy).toHaveBeenNthCalledWith(2, client.key.pong, { path: ['__base__', 'key', 'pong'] })

    expect(pongUtils.key()).toEqual(generalUtilsSpy.mock.results[1]!.value.key())
    expect(pongUtils.queryOptions().key.value).toEqual(procedureUtilsSpy.mock.results[1]!.value.queryOptions().key.value)
  })

  it('not recursive on symbol', async () => {
    const utils = createRouterUtils(client, {
      path: ['__base__'],
    }) as any

    expect(utils[Symbol.for('a')]).toBe(undefined)
  })

  it('safe on primitive coercion and serialization', () => {
    const utils = createRouterUtils(client) as any

    expect(() => String(utils)).not.toThrow()
    expect(() => `${utils}`).not.toThrow()
    expect(() => `${utils.key}`).not.toThrow()
    expect(() => JSON.stringify({ utils })).not.toThrow()

    expect(client).not.toBeCalled()
    expect(client.key).not.toBeCalled()
  })

  it('not recursive on non-object clients', () => {
    const utils = createRouterUtils(undefined as any) as any

    expect(utils.nonExists).toBeUndefined()
    expect(utils.key()).toEqual(generalUtilsSpy.mock.results[0]!.value.key())
  })
})
