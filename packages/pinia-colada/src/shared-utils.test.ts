import { RPCJsonSerializer } from '@orpc/client'
import * as KeyModule from './key'
import { SharedUtils } from './shared-utils'

const generateOperationKeySpy = vi.spyOn(KeyModule, 'generateOperationKey')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sharedUtils', () => {
  const utils = new SharedUtils(['path'], {})

  it('.key', () => {
    expect(
      utils.key({ input: { search: '__search__' }, type: 'query' }),
    ).toBe(generateOperationKeySpy.mock.results[0]!.value)

    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['path'], { input: { search: '__search__' }, type: 'query', prefix: undefined })
  })

  it('.key with key options', () => {
    const serializer = new RPCJsonSerializer()
    const keyedUtils = new SharedUtils(['path'], { prefix: '__prefix__', serializer })

    expect(
      keyedUtils.key({ type: 'query' }),
    ).toBe(generateOperationKeySpy.mock.results[0]!.value)

    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['path'], { type: 'query', prefix: '__prefix__', serializer })
  })
})
