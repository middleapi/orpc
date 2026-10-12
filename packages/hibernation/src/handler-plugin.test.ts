import { oc } from '@orpc/contract'
import { asyncIteratorObject, implement, os, type } from '@orpc/server'
import { RPCHandlerCodec, StandardHandler } from '@orpc/server/standard'
import { RPCHandler } from '@orpc/server/websocket'
import { decodePeerMessage, encodePeerMessage, HibernationAsyncIteratorClass } from '@standard-server/peer'
import { encodeHibernationRPCEvent } from './encode-event'
import { HibernationHandlerPlugin } from './handler-plugin'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('hibernationHandlerPlugin', () => {
  const callback = vi.fn()
  const interceptor = vi.fn(({ next }) => next())

  const router = {
    ping: os.handler(() => new HibernationAsyncIteratorClass(callback)),
    pong: os.handler(() => 'pong'),
    withSchema: os
      .output(asyncIteratorObject(type<string>()))
      .handler(() => new HibernationAsyncIteratorClass<string>(callback)),
    contractFirst: implement(oc.output(asyncIteratorObject(type<string>())))
      .handler(() => new HibernationAsyncIteratorClass<string>(callback)),
    replacedByMiddleware: os
      .use(async ({ next }) => {
        await next()
        return { output: 'replaced', context: {} }
      })
      .output(asyncIteratorObject(type<string>()))
      .handler(() => new HibernationAsyncIteratorClass<string>(callback)),
  }

  const options = {
    plugins: [
      new HibernationHandlerPlugin(),
    ],
    interceptors: [
      interceptor,
    ],
  }

  const handler = new StandardHandler(new RPCHandlerCodec(router), options)

  const createRequest = (url: string) => ({
    url,
    method: 'POST',
    headers: {},
    signal: undefined,
    resolveBody: () => Promise.resolve(undefined),
  } as any)

  it('sets body as HibernationAsyncIteratorClass if output is HibernationAsyncIteratorClass', async () => {
    const { response } = await handler.handle(createRequest('/ping'), {
      context: {},
    })

    expect(response!.status).toBe(200)
    expect(response!.body).toBeInstanceOf(HibernationAsyncIteratorClass)
  })

  it.each(['withSchema', 'contractFirst'])('sets body as the original HibernationAsyncIteratorClass behind an output schema: %s', async (path) => {
    const { response } = await handler.handle(createRequest(`/${path}`), {
      context: {},
    })

    expect(response!.status).toBe(200)
    expect(response!.body).toBeInstanceOf(HibernationAsyncIteratorClass)

    const body = response!.body as HibernationAsyncIteratorClass<any>
    body['~callback']!('1')
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('1')
  })

  it('does nothing if a middleware replaces the HibernationAsyncIteratorClass output', async () => {
    const { response } = await handler.handle(createRequest('/replacedByMiddleware'), {
      context: {},
    })

    expect(response!.status).toBe(200)
    expect(response!.body).toEqual({ json: 'replaced' })
  })

  it('does nothing if output is not HibernationAsyncIteratorClass', async () => {
    const { response } = await handler.handle(createRequest('/pong'), {
      context: {},
    })

    expect(response!.status).toBe(200)
    expect(response!.body).toEqual({ json: 'pong' })
  })

  it('does nothing if not matched', async () => {
    const { matched } = await handler.handle(createRequest('/not-found'), {
      context: {},
    })

    expect(matched).toBe(false)
  })

  it('errors if Hibernation context is corrupted', async () => {
    interceptor.mockImplementationOnce(({ next, ...options }) => next({ ...options, context: {} }))

    const { response } = await handler.handle(createRequest('/ping'), {
      context: {},
    })

    expect(response?.status).toBe(500)
  })

  describe('websocket integration', () => {
    it.each(['ping', 'withSchema', 'contractFirst'])('invokes the hibernation callback with the request id and can send events later: %s', async (path) => {
      const handler = new RPCHandler(router, options)

      const ws = {
        addEventListener: vi.fn(),
        send: vi.fn(() => undefined),
      }

      const request = await encodePeerMessage({
        id: '19',
        kind: 'request',
        json: {
          url: `/${path}`,
          method: 'POST',
          headers: {},
          body: undefined,
        },
      })

      const result = await handler.message(ws as any, request)

      expect(result.matched).toBe(true)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('19')

      // only the response message is sent, events are sent manually later
      expect(ws.send).toHaveBeenCalledTimes(1)
      const decoded = decodePeerMessage((ws as any).send.mock.calls[0][0]) as any
      expect(decoded.message.kind).toBe('response')
      expect(decoded.message.json.headers).toEqual({ 'standard-server': 'event-stream' })

      // events encoded with the request id belong to the same stream on the wire
      const event = await encodeHibernationRPCEvent('19', 'hello')
      const decodedEvent = decodePeerMessage(event as string) as any
      expect(decodedEvent.message).toEqual({
        kind: 'event-stream',
        id: '19',
        json: { data: { json: 'hello' } },
      })
    })
  })
})
