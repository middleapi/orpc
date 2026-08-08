import type { ClientContext, ClientLink } from './types'
import { createORPCClient } from './client'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createORPCClient', () => {
  const mockedLink: ClientLink<ClientContext> = {
    call: vi.fn().mockReturnValue('__mocked__'),
  }

  it('works', async () => {
    const client = createORPCClient(mockedLink) as any

    expect(await client.ping({ value: 'hello' })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['ping'], { value: 'hello' }, { context: {} })

    vi.clearAllMocks()
    expect(await client.nested.pong({ value: 'hello' })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['nested', 'pong'], { value: 'hello' }, { context: {} })
  })

  it('works with signal', async () => {
    const controller = new AbortController()
    const signal = controller.signal
    const client = createORPCClient(mockedLink) as any

    expect(await client.ping({ value: 'hello' }, { signal })).toEqual('__mocked__')
    expect(mockedLink.call).toBeCalledTimes(1)
    expect(mockedLink.call).toBeCalledWith(['ping'], { value: 'hello' }, { signal, context: {} })
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

  it('not recursive on unwrap keys', async () => {
    const client = createORPCClient(mockedLink) as any

    expect(() => String(client)).not.toThrow()
    expect(() => `${client}`).not.toThrow()
    expect(() => `${client.nested}`).not.toThrow()
    expect(JSON.stringify(client)).toBeUndefined()
    expect(JSON.stringify({ client })).toEqual('{}')
    expect(typeof client.bind).toEqual('function')
    expect(typeof client.nested.bind).toEqual('function')

    expect(mockedLink.call).not.toBeCalled()
  })

  it('prevent native await', async () => {
    const client = createORPCClient(mockedLink) as any

    const client2 = await client
    expect(await client2.then({ value: 'client2' })).toEqual('__mocked__')
    expect(mockedLink.call).toHaveBeenNthCalledWith(1, ['then'], { value: 'client2' }, { context: {} })

    const client3 = await client2.then
    expect(await client3.something({ value: 'client3' })).toEqual('__mocked__')
    expect(mockedLink.call).toHaveBeenNthCalledWith(2, ['then', 'something'], { value: 'client3' }, { context: {} })

    const client4 = await client3.something
    expect(await client4.then({ value: 'client4' })).toEqual('__mocked__')
    expect(mockedLink.call).toHaveBeenNthCalledWith(3, ['then', 'something', 'then'], { value: 'client4' }, { context: {} })
  })
})
