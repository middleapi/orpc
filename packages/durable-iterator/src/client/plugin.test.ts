import { StandardRPCLink } from '@orpc/client/standard'
import { os } from '@orpc/server'
import { StandardRPCHandler } from '@orpc/server/standard'
import { isAsyncIteratorObject, sleep } from '@orpc/shared'
import { decodeRequestMessage, encodeResponseMessage, MessageType } from '@orpc/standard-server-peer'
import { WebSocket as ReconnectableWebSocket } from 'partysocket'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DURABLE_ITERATOR_TOKEN_PARAM } from '../consts'
import { DurableIteratorError } from '../error'
import { DurableIterator } from '../iterator'
import { DurableIteratorHandlerPlugin } from '../plugin'
import { parseDurableIteratorToken } from '../schemas'
import { getClientDurableIteratorToken } from './iterator'
import { DurableIteratorLinkPlugin } from './plugin'

const realSetTimeout = globalThis.setTimeout

vi.mock('partysocket', () => {
  return {
    WebSocket: vi.fn(() => ({
      readyState: 1, // OPEN
      addEventListener: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      reconnect: vi.fn(),
    })),
  }
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('durableIteratorLinkPlugin', async () => {
  const interceptor = vi.fn(({ next }) => next())
  const durableIteratorHandler = vi.fn(
    () => new DurableIterator<any, any>('some-room', { signingKey: 'signing-key', tags: ['tag'] }).rpc('getUser', 'sendMessage'),
  )
  const refreshTokenBeforeExpireInSeconds = vi.fn(() => Number.NaN)
  const refreshTokenDelayInSeconds = vi.fn(() => 2)

  const handler = new StandardRPCHandler({
    durableIterator: os.handler(durableIteratorHandler),
    regularResponse: os.handler(() => 'regular response'),
  }, {
    plugins: [
      new DurableIteratorHandlerPlugin(),
    ],
  })

  const link = new StandardRPCLink({
    async call(request) {
      const result = await handler.handle({ ...request, body: () => Promise.resolve(request.body) }, {
        context: {},
      })

      const response = result.response!

      return { ...response, body: () => Promise.resolve(response.body) }
    },
  }, {
    url: 'http://localhost',
    clientInterceptors: [interceptor],
    plugins: [
      new DurableIteratorLinkPlugin({
        url: 'ws://localhost',
        refreshTokenBeforeExpireInSeconds,
        refreshTokenDelayInSeconds,
      }),
    ],
  })

  it('should do nothing if not a durable iterator response', async () => {
    const output = await link.call(['regularResponse'], {}, {
      context: {},
    })

    expect(output).toEqual('regular response')
  })

  it('should throw error if plugin context is corrupted', async () => {
    interceptor.mockImplementationOnce(({ next, ...options }) => next({ ...options, context: {} }))

    await expect(link.call(['regularResponse'], {}, { context: {} })).rejects.toThrow(
      new DurableIteratorError('Plugin context has been corrupted or modified by another plugin or interceptor'),
    )
  })

  it('should resolve durable iterator', async () => {
    const outputPromise = link.call(['durableIterator'], {}, { context: {}, lastEventId: '__initialEventId__' }) as any

    await vi.waitFor(async () => {
      expect(ReconnectableWebSocket).toHaveBeenCalledOnce()
      const urlProvider = vi.mocked(ReconnectableWebSocket).mock.calls[0]![0] as any
      const url = new URL(await urlProvider())

      expect(url.toString()).toContain('ws://localhost')
      expect(url.toString()).toContain('token=')
      expect(url.toString()).toContain('id=')
      expect(parseDurableIteratorToken(url.searchParams.get(DURABLE_ITERATOR_TOKEN_PARAM)!)).toBeTypeOf('object')

      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      const [id, ,payload] = await decodeRequestMessage(ws.send.mock.calls[0][0])

      // make sure it use user-provided lastEventId for initial lastEventId
      expect((payload as any).headers['last-event-id']).toBe('__initialEventId__')

      const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

      onMessage({
        data: await encodeResponseMessage(id, MessageType.RESPONSE, {
          body: (async function* () { }()),
          status: 200,
          headers: {},
        }),
      })
    })

    const output = await outputPromise
    expect(output).toSatisfy(isAsyncIteratorObject)

    expect(output.getUser).toBeInstanceOf(Function)
    expect(output.sendMessage).toBeInstanceOf(Function)
    expect(output.random).not.toBeDefined()

    // RPC

    const userPromise = output.getUser()

    await vi.waitFor(async () => {
      expect(ReconnectableWebSocket).toHaveBeenCalledOnce()
      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      const [id] = await decodeRequestMessage(ws.send.mock.calls[1][0])

      const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

      onMessage({
        data: await encodeResponseMessage(id, MessageType.RESPONSE, {
          body: { json: 'user' },
          status: 200,
          headers: {},
        }),
      })
    })

    const user = await userPromise
    expect(user).toEqual('user')
  })

  describe('refresh expired token', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2022-01-01T00:00:00.000Z'))
    })
    afterEach(async () => {
      await new Promise(resolve => realSetTimeout(resolve, 1000)) // await for all promises resolved
      expect(vi.getTimerCount()).toBe(0) // every is cleanup
      vi.useRealTimers()
    })

    it('works', async () => {
      refreshTokenBeforeExpireInSeconds.mockImplementation(() => 9)
      durableIteratorHandler.mockImplementation(
        () => new DurableIterator<any, any>('some-room', {
          signingKey: 'signing-key',
          tokenTTLSeconds: 10,
        }) as any,
      )

      const outputPromise = link.call(['durableIterator'], {}, { context: {} }) as any

      await vi.waitFor(async () => {
        expect(ReconnectableWebSocket).toHaveBeenCalledOnce()

        const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
        const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

        const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

        onMessage({
          data: await encodeResponseMessage(id, MessageType.RESPONSE, {
            body: (async function* () { }()),
            status: 200,
            headers: {},
          }),
        })
      })

      const output = await outputPromise
      expect(output).toSatisfy(isAsyncIteratorObject)

      expect(vi.getTimerCount()).toBe(1) // refresh token is enabled

      const urlProvider = vi.mocked(ReconnectableWebSocket).mock.calls[0]![0] as any
      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      ws.send.mockClear()

      const url1 = await urlProvider()
      const token1 = getClientDurableIteratorToken(output)
      expect(token1).toBeTypeOf('string')
      expect(durableIteratorHandler).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(500) // not expired yet
      expect(vi.getTimerCount()).toBe(1) // no refresh executed
      expect(await urlProvider()).toEqual(url1)
      expect(getClientDurableIteratorToken(output)).toEqual(token1)
      expect(durableIteratorHandler).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(500) // expired
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(r => realSetTimeout(r, 10)) // wait for token refresh promise
      const url2 = await urlProvider()
      expect(url2).not.toEqual(url1)
      const token2 = getClientDurableIteratorToken(output)
      expect(token2).not.toEqual(token1)
      expect(durableIteratorHandler).toHaveBeenCalledTimes(2)
      expect(ws.send).toHaveBeenCalledTimes(1) // send set token request to durable iterator
      expect(vi.getTimerCount()).toBe(1) // new timer started

      vi.advanceTimersByTime(2000) // wait next retry + refreshTokenDelayInSeconds delay
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(r => realSetTimeout(r, 10)) // wait for token refresh promise
      const url3 = await urlProvider()
      expect(url3).not.toEqual(url1)
      expect(url3).not.toEqual(url2)
      const token3 = getClientDurableIteratorToken(output)
      expect(token3).not.toEqual(token1)
      expect(token3).not.toEqual(token2)
      expect(durableIteratorHandler).toHaveBeenCalledTimes(3)
      expect(ws.send).toHaveBeenCalledTimes(2) // send set token request to durable iterator
      expect(vi.getTimerCount()).toBe(1) // new timer started

      expect(refreshTokenBeforeExpireInSeconds).toHaveBeenCalledTimes(3)
      expect(refreshTokenBeforeExpireInSeconds).toHaveBeenCalledWith(
        parseDurableIteratorToken(new URL(url1).searchParams.get(DURABLE_ITERATOR_TOKEN_PARAM)!),
        expect.objectContaining({ path: ['durableIterator'] }),
      )
      expect(refreshTokenDelayInSeconds).toHaveBeenCalledTimes(3)
      expect(refreshTokenDelayInSeconds).toHaveBeenCalledWith(
        parseDurableIteratorToken(new URL(url1).searchParams.get(DURABLE_ITERATOR_TOKEN_PARAM)!),
        expect.objectContaining({ path: ['durableIterator'] }),
      )

      await output.return() // cleanup
    })

    it('not refresh if option returns NaN', async () => {
      refreshTokenBeforeExpireInSeconds.mockImplementation(() => Number.NaN)
      durableIteratorHandler.mockImplementation(
        () => new DurableIterator<any, any>('some-room', {
          signingKey: 'signing-key',
          tokenTTLSeconds: 1,
        }) as any,
      )

      const outputPromise = link.call(['durableIterator'], {}, { context: {} }) as any

      await vi.waitFor(async () => {
        expect(ReconnectableWebSocket).toHaveBeenCalledOnce()

        const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
        const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

        const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

        onMessage({
          data: await encodeResponseMessage(id, MessageType.RESPONSE, {
            body: (async function* () { }()),
            status: 200,
            headers: {},
          }),
        })
      })

      const output = await outputPromise
      expect(output).toSatisfy(isAsyncIteratorObject)

      expect(vi.getTimerCount()).toBe(0) // refresh token is disabled

      await output.return() // cleanup
    })

    it('if refresh token is invalid', async () => {
      refreshTokenBeforeExpireInSeconds.mockImplementation(() => 9)
      durableIteratorHandler.mockImplementationOnce(
        () => new DurableIterator<any, any>('some-room', {
          signingKey: 'signing-key',
          tokenTTLSeconds: 10,
        }) as any,
      )

      const outputPromise = link.call(['durableIterator'], {}, { context: {} }) as any

      await vi.waitFor(async () => {
        expect(ReconnectableWebSocket).toHaveBeenCalledOnce()

        const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
        const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

        const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

        onMessage({
          data: await encodeResponseMessage(id, MessageType.RESPONSE, {
            body: (async function* () { }()),
            status: 200,
            headers: {},
          }),
        })
      })

      const output = await outputPromise
      expect(output).toSatisfy(isAsyncIteratorObject)

      expect(vi.getTimerCount()).toBe(1) // refresh token is enabled

      const urlProvider = vi.mocked(ReconnectableWebSocket).mock.calls[0]![0] as any

      const url = await urlProvider()
      expect(durableIteratorHandler).toHaveBeenCalledTimes(1)

      durableIteratorHandler.mockResolvedValueOnce('invalid-token' as any)
      vi.advanceTimersByTime(1000) // wait first retry trigger
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(resolve => realSetTimeout(resolve, 10)) // wait for token refresh promise
      await expect(urlProvider()).resolves.toBe(url) // not change url because new token is invalid
      expect(durableIteratorHandler).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(1) // timer created by retry helper

      durableIteratorHandler.mockResolvedValueOnce({} as any)
      vi.advanceTimersByTime(2000) // wait next retry
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(resolve => realSetTimeout(resolve, 10)) // wait for token refresh promise
      await expect(urlProvider()).resolves.toBe(url) // not change url because new token is invalid
      expect(durableIteratorHandler).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(1) // timer created by retry helper

      // only called once, because it still retrying after invalid token
      expect(refreshTokenBeforeExpireInSeconds).toHaveBeenCalledTimes(1)

      const unhandledRejectionHandler = vi.fn()
      process.on('unhandledRejection', unhandledRejectionHandler)
      afterEach(() => {
        process.off('unhandledRejection', unhandledRejectionHandler)
      })

      // .return should stop retry token - in case invalid token returns
      durableIteratorHandler.mockImplementation(async () => {
        await sleep(2000)
        return {} as any
      })
      vi.advanceTimersByTime(2000) // wait next retry
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(resolve => realSetTimeout(resolve, 10)) // wait for token refresh trigger
      await output.return() // cleanup

      vi.advanceTimersByTime(2000) // wait handler throw
      await new Promise(resolve => realSetTimeout(resolve, 10)) // wait for token refresh reject
      expect(unhandledRejectionHandler).toHaveBeenCalledTimes(1)
      expect(unhandledRejectionHandler.mock.calls[0]![0]).toEqual(
        new DurableIteratorError(`Expected valid token for procedure durableIterator`),
      )
    })

    it('reconnect if refresh token channel mismatch', async () => {
      refreshTokenBeforeExpireInSeconds.mockImplementation(() => 9)
      durableIteratorHandler.mockImplementationOnce(
        () => new DurableIterator<any, any>('some-room', {
          signingKey: 'signing-key',
          tokenTTLSeconds: 10,
        }) as any,
      )

      const outputPromise = link.call(['durableIterator'], {}, { context: {} }) as any

      await vi.waitFor(async () => {
        expect(ReconnectableWebSocket).toHaveBeenCalledOnce()

        const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
        const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

        const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

        onMessage({
          data: await encodeResponseMessage(id, MessageType.RESPONSE, {
            body: (async function* () { }()),
            status: 200,
            headers: {},
          }),
        })
      })

      const output = await outputPromise
      expect(output).toSatisfy(isAsyncIteratorObject)

      expect(vi.getTimerCount()).toBe(1) // refresh token is enabled

      durableIteratorHandler.mockResolvedValueOnce(
        new DurableIterator<any, any>('a-different-channel', { signingKey: 'signing-key' }).rpc('getUser', 'sendMessage') as any,
      )

      vi.advanceTimersByTime(1000)
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(resolve => realSetTimeout(resolve, 10)) // wait for token refresh promise
      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      expect(ws.reconnect).toHaveBeenCalledTimes(1)
      expect(await (ReconnectableWebSocket as any).mock.calls[0]![0]()).toContain('a-different-channel')
      expect(vi.getTimerCount()).toBe(1) // new refresh token timer created

      await output.return() // cleanup
    })

    it('reconnect if refresh token tags mismatch', async () => {
      refreshTokenBeforeExpireInSeconds.mockImplementation(() => 9)
      durableIteratorHandler.mockImplementationOnce(
        () => new DurableIterator<any, any>('some-room', {
          tags: ['tag'],
          signingKey: 'signing-key',
          tokenTTLSeconds: 10,
        }) as any,
      )

      const outputPromise = link.call(['durableIterator'], {}, { context: {} }) as any

      await vi.waitFor(async () => {
        expect(ReconnectableWebSocket).toHaveBeenCalledOnce()

        const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
        const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

        const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

        onMessage({
          data: await encodeResponseMessage(id, MessageType.RESPONSE, {
            body: (async function* () { }()),
            status: 200,
            headers: {},
          }),
        })
      })

      const output = await outputPromise
      expect(output).toSatisfy(isAsyncIteratorObject)

      expect(vi.getTimerCount()).toBe(1) // refresh token is enabled

      durableIteratorHandler.mockImplementationOnce(
        () => new DurableIterator<any, any>('some-room', {
          tags: ['a-different-tag'],
          signingKey: 'signing-key',
          tokenTTLSeconds: 10,
        }) as any,
      )

      vi.advanceTimersByTime(1000)
      expect(vi.getTimerCount()).toBe(0) // refresh token executed
      await new Promise(resolve => realSetTimeout(resolve, 10)) // wait for token refresh promise
      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      expect(ws.reconnect).toHaveBeenCalledTimes(1)
      expect(await (ReconnectableWebSocket as any).mock.calls[0]![0]()).toContain('a-different-tag')
      expect(vi.getTimerCount()).toBe(1) // new refresh token timer created

      await output.return() // cleanup
    })
  })

  it('throw right away if signal is aborted before establishing websocket connection', async () => {
    const controller = new AbortController()
    const signal = controller.signal

    durableIteratorHandler.mockImplementationOnce(
      () => {
        controller.abort() // abort during fetch token before connection is established
        return new DurableIterator<any, any>('some-room', { signingKey: 'signing-key' }) as any
      },
    )

    await expect(link.call(['durableIterator'], {}, { context: {}, signal })).rejects.toThrow(signal.reason)
  })

  it('cancel websocket if signal is aborted', async () => {
    const controller = new AbortController()
    const signal = controller.signal

    const outputPromise = link.call(['durableIterator'], {}, { context: {}, signal }) as any

    await vi.waitFor(async () => {
      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

      const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

      onMessage({
        data: await encodeResponseMessage(id, MessageType.RESPONSE, {
          body: (async function* () { }()),
          status: 200,
          headers: {},
        }),
      })
    })

    await outputPromise

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    controller.abort()

    const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
    expect(ws.close).toHaveBeenCalledTimes(1)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('cancel websocket if iterator return is called', async () => {
    const controller = new AbortController()
    const signal = controller.signal
    const removeEventListenerSpy = vi.spyOn(signal, 'removeEventListener')

    const outputPromise = link.call(['durableIterator'], {}, { context: {}, signal }) as any

    await vi.waitFor(async () => {
      const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
      const [id] = await decodeRequestMessage(ws.send.mock.calls[0][0])

      const [, onMessage] = vi.mocked(ws.addEventListener).mock.calls.find(([event]: any[]) => event === 'message') as any

      onMessage({
        data: await encodeResponseMessage(id, MessageType.RESPONSE, {
          body: (async function* () { }()),
          status: 200,
          headers: {},
        }),
      })
    })

    const output = await outputPromise as any

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    await output.return()

    const ws = vi.mocked(ReconnectableWebSocket).mock.results[0]!.value
    expect(ws.close).toHaveBeenCalledTimes(1)

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function)) // ensure it cleanups the event listener

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })
})
