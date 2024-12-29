import type { ClientLink } from './types'
import { createORPCClient } from './client'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createORPCClient', () => {
  const mockedLink: ClientLink<unknown> = {
    call: vi.fn().mockReturnValue('__mocked__'),
  }

  it('works', async () => {
    const client = createORPCClient(mockedLink) as any

    expect(await client.ping({ value: 'hello' })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['ping'], { value: 'hello' }, {})

    vi.clearAllMocks()
    expect(await client.nested.pong({ value: 'hello' })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['nested', 'pong'], { value: 'hello' }, {})
  })

  it('works with signal', async () => {
    const controller = new AbortController()
    const signal = controller.signal
    const client = createORPCClient(mockedLink) as any

    expect(await client.ping({ value: 'hello' }, { signal })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['ping'], { value: 'hello' }, { signal })
  })

  it('works with context', async () => {
    const client = createORPCClient(mockedLink) as any

    expect(await client.ping({ value: 'hello' }, { context: { userId: '123' } })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['ping'], { value: 'hello' }, { context: { userId: '123' } })
  })

  it('not recursive on symbol', async () => {
    const client = createORPCClient(mockedLink) as any
    expect(client[Symbol('test')]).toBeUndefined()
  })
})
