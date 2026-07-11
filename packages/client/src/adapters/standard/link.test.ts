import type { StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { StandardLinkCodec } from './codec'
import type { StandardLinkTransport } from './transport'
import { isAsyncIteratorObject } from '@orpc/shared'
import { ORPCError } from '../../error'
import { StandardLink } from './link'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('standardLink', () => {
  function makeCodec(): StandardLinkCodec<any> {
    return {
      encodeInput: vi.fn(),
      decodeResponse: vi.fn(),
    }
  }

  function makeTransport(): StandardLinkTransport<any> {
    return {
      send: vi.fn(),
    }
  }

  it('workflow is correct', async () => {
    const interceptor = vi.fn(({ next }) => next())
    const transportInterceptor = vi.fn(({ next }) => next())

    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      interceptors: [interceptor],
      transportInterceptors: [transportInterceptor],
    })

    const __standardRequest: StandardRequest = {
      method: 'POST',
      url: '/planet/create',
      headers: {},
      body: '__standard_request__',
      signal: AbortSignal.timeout(100),
    }

    const __standardResponse: StandardLazyResponse = {
      status: 200,
      headers: {},
      resolveBody: () => Promise.resolve('__body__'),
    }

    vi.mocked(codec.encodeInput).mockResolvedValueOnce(__standardRequest)
    vi.mocked(transport.send).mockResolvedValueOnce(__standardResponse)
    vi.mocked(codec.decodeResponse).mockResolvedValueOnce({ kind: 'output', output: '__output__' })

    const context = { context: true }
    const signal = AbortSignal.timeout(100)
    const lastEventId = '__lastEventId__'

    const output = await link.call(['planet', 'create'], { name: 'Earth' }, { context, signal, lastEventId })

    expect(output).toEqual('__output__')

    expect(codec.encodeInput).toHaveBeenCalledTimes(1)
    expect(codec.encodeInput).toHaveBeenCalledWith(
      { name: 'Earth' },
      ['planet', 'create'],
      { context, signal, lastEventId },
    )

    expect(transport.send).toHaveBeenCalledTimes(1)
    expect(transport.send).toHaveBeenCalledWith(
      __standardRequest,
      ['planet', 'create'],
      { context, signal, lastEventId },
    )

    expect(codec.decodeResponse).toHaveBeenCalledTimes(1)
    expect(codec.decodeResponse).toHaveBeenCalledWith(
      __standardResponse,
      ['planet', 'create'],
      { context, signal, lastEventId },
    )

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveBeenCalledWith({
      next: expect.any(Function),
      path: ['planet', 'create'],
      input: { name: 'Earth' },
      context,
      signal,
      lastEventId,
    })
    await expect(interceptor.mock.results[0]!.value).resolves.toBe('__output__')

    expect(transportInterceptor).toHaveBeenCalledTimes(1)
    expect(transportInterceptor).toHaveBeenCalledWith({
      next: expect.any(Function),
      request: __standardRequest,
      path: ['planet', 'create'],
      context,
      signal,
      lastEventId,
    })
    await expect(transportInterceptor.mock.results[0]!.value).resolves.toBe(__standardResponse)
  })

  it('throws decoded error when response kind is error', async () => {
    const codec = makeCodec()
    const transport = makeTransport()
    const link = new StandardLink(codec, transport)

    const error = new ORPCError('NOT_FOUND')

    vi.mocked(codec.encodeInput).mockResolvedValueOnce({
      method: 'POST',
      url: '/test',
      headers: {},
      body: undefined,
    })
    vi.mocked(transport.send).mockResolvedValueOnce({
      status: 404,
      headers: {},
      resolveBody: () => Promise.resolve(undefined),
    })
    vi.mocked(codec.decodeResponse).mockResolvedValueOnce({ kind: 'error', error })

    await expect(link.call(['test'], 'input', { context: {} })).rejects.toThrow(error)
  })

  it('traces input & output AsyncIteratorObject', async () => {
    const codec = makeCodec()
    const transport = makeTransport()
    const link = new StandardLink(codec, transport)

    async function* gen() {
      yield 1
      yield 2
    }
    const input = gen()
    const output = gen()

    vi.mocked(codec.encodeInput).mockResolvedValueOnce({
      method: 'POST',
      url: '/test',
      headers: {},
      body: undefined,
    })
    vi.mocked(transport.send).mockResolvedValueOnce({
      status: 200,
      headers: {},
      resolveBody: () => Promise.resolve(undefined),
    })
    vi.mocked(codec.decodeResponse).mockResolvedValueOnce({ kind: 'output', output })

    const tracedOutput = await link.call(['test'], input, { context: {} })

    const passedInput = vi.mocked(codec.encodeInput).mock.calls[0]![0]
    expect(isAsyncIteratorObject(passedInput)).not.toBe(input) // should be a wrapped version of the original input
    expect(isAsyncIteratorObject(passedInput)).toBe(true)

    expect(tracedOutput).not.toBe(output) // should be a wrapped version of the original output
    expect(isAsyncIteratorObject(tracedOutput)).toBe(true)
  })

  it('supports plugins', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [{ name: 'test-plugin', init: () => ({ interceptors: [async () => '__INTERCEPTED__'] }) }],
    })

    await expect(link.call(['test'], 'input', { context: {} })).resolves.toBe('__INTERCEPTED__')
  })
})
