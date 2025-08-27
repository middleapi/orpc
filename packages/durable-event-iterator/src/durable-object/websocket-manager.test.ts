import { withEventMeta } from '@orpc/server'
import * as Hibernation from '@orpc/server/hibernation'
import { createCloudflareWebsocket, createDurableObjectState } from '../../tests/shared'
import { DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY, DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY } from './consts'
import { DurableEventIteratorObjectEventStorage } from './event-storage'
import { DurableEventIteratorObjectWebsocketManager } from './websocket-manager'

vi.mock('@orpc/server/hibernation', { spy: true })
const encodeHibernationRPCEventSpy = vi.spyOn(Hibernation, 'encodeHibernationRPCEvent')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('durableEventIteratorObjectWebsocketManager', () => {
  it('serialize/deserialize attachment', () => {
    const ctx = createDurableObjectState()
    const storage = new DurableEventIteratorObjectEventStorage(ctx)
    const websocket = createCloudflareWebsocket()
    const manager = new DurableEventIteratorObjectWebsocketManager<any, any, any>(
      ctx,
      storage,
    )
    const tokIat = Math.floor(Date.now() / 1000)
    const tokExpiration = tokIat + 3600
    /**
     * Usually set hibernation happen after token payload, but this for test coverage
     */
    manager.serializeInternalAttachment(websocket, {
      [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '0',
    })
    /**
     * Initial attachment, executed internally
     */
    manager.serializeInternalAttachment(websocket, {
      [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
        att: { att: true },
        chn: 'test-channel',
        exp: tokExpiration,
        iat: tokIat,
        rpc: ['test'],
      },
    })
    // safely override the hibernation id
    manager.serializeInternalAttachment(websocket, {
      [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '123',
    })

    manager.serializeAttachment(websocket, {
      some: 'data',
      [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: 'invalid',
      [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: 'invalid',
    })

    expect(manager.deserializeAttachment(websocket)).toEqual({
      [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
        att: { att: true },
        chn: 'test-channel',
        exp: tokExpiration,
        iat: tokIat,
        rpc: ['test'],
      },
      [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '123',
      some: 'data',
    })
  })

  it('publish event', async () => {
    const ctx = createDurableObjectState()
    const storage = new DurableEventIteratorObjectEventStorage(ctx)
    const websocket = createCloudflareWebsocket()
    const websocket2 = createCloudflareWebsocket()
    const options = {
      customJsonSerializers: [],
    }
    const tokIat = Math.floor(Date.now() / 1000)
    const tokExpiration = tokIat + 3600
    const manager = new DurableEventIteratorObjectWebsocketManager<any, any, any>(
      ctx,
      storage,
      options,
    )

    /**
     * Initial attachment, executed internally
     */
    manager.serializeInternalAttachment(websocket, {
      [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
        att: { att: true },
        chn: 'test-channel',
        exp: tokExpiration,
        iat: tokIat,
        rpc: ['test'],
      },
      [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '123',
    })

    manager.serializeInternalAttachment(websocket2, {
      [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
        att: { att: true },
        chn: 'test-channel',
        exp: tokExpiration,
        iat: tokIat,
        rpc: ['test'],
      },
    })

    const wss = [websocket, websocket2]
    await manager.publishEvent(wss, { test: 'event1' })
    await manager.publishEvent(wss, { test: 'event2' })
    expect(encodeHibernationRPCEventSpy).toHaveBeenCalledTimes(2)
    expect(encodeHibernationRPCEventSpy).toHaveBeenNthCalledWith(1, '123', withEventMeta({ test: 'event1' }, { id: '1' }), options)
    expect(encodeHibernationRPCEventSpy).toHaveBeenNthCalledWith(2, '123', withEventMeta({ test: 'event2' }, { id: '2' }), options)

    expect(storage.getEventsAfter('0')).toHaveLength(2)

    expect(websocket.send).toHaveBeenCalledTimes(2)
    expect(websocket.send).toHaveBeenNthCalledWith(1, encodeHibernationRPCEventSpy.mock.results[0]!.value)
    expect(websocket.send).toHaveBeenNthCalledWith(2, encodeHibernationRPCEventSpy.mock.results[1]!.value)

    // ignore websocket not having hibernation id
    expect(websocket2.send).toHaveBeenCalledTimes(0)
  })

  it('sendEventsAfter', async () => {
    const ctx = createDurableObjectState()
    const storage = new DurableEventIteratorObjectEventStorage(ctx)
    const websocket = createCloudflareWebsocket()
    const tokIat = Math.floor(Date.now() / 1000)

    const options = {
      customJsonSerializers: [],
    }

    const manager = new DurableEventIteratorObjectWebsocketManager<any, any, any>(
      ctx,
      storage,
      options,
    )
    manager.serializeInternalAttachment(websocket, {
      [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
        att: { att: true },
        chn: 'test-channel',
        exp: tokIat + 3600,
        iat: tokIat,
        rpc: ['test'],
      },
      [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '123',
    })
    storage.storeEvent({ test: 'event1' })
    storage.storeEvent({ test: 'event2' })
    storage.storeEvent({ test: 'event3' })

    await manager.sendEventsAfter(websocket, '123', '1')

    expect(encodeHibernationRPCEventSpy).toHaveBeenCalledTimes(2)
    expect(encodeHibernationRPCEventSpy).toHaveBeenNthCalledWith(1, '123', withEventMeta({ test: 'event2' }, { id: '2' }), options)
    expect(encodeHibernationRPCEventSpy).toHaveBeenNthCalledWith(2, '123', withEventMeta({ test: 'event3' }, { id: '3' }), options)

    expect(websocket.send).toHaveBeenCalledTimes(2)
    expect(websocket.send).toHaveBeenNthCalledWith(1, encodeHibernationRPCEventSpy.mock.results[0]!.value)
    expect(websocket.send).toHaveBeenNthCalledWith(2, encodeHibernationRPCEventSpy.mock.results[1]!.value)
  })
})

it('publishEvent closes sockets with expired tokens and skips sending', async () => {
  vi.useFakeTimers()
  const fixedNow = new Date('2025-01-01T00:00:00Z')
  vi.setSystemTime(fixedNow)
  const nowSec = Math.floor(fixedNow.getTime() / 1000)

  const ctx = createDurableObjectState()
  const storage = new DurableEventIteratorObjectEventStorage(ctx)
  const websocketValid = createCloudflareWebsocket()
  const websocketExpired = createCloudflareWebsocket()
  const options = { customJsonSerializers: [] }

  // ensure `close` is a mock so we can assert on it
  ;(websocketValid as any).close = vi.fn()
  ;(websocketExpired as any).close = vi.fn()

  const manager = new DurableEventIteratorObjectWebsocketManager<any, any, any>(
    ctx,
    storage,
    options,
  )

  // valid token
  manager.serializeInternalAttachment(websocketValid, {
    [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
      att: { att: true },
      chn: 'test-channel',
      exp: nowSec + 60,
      iat: nowSec - 10,
      rpc: ['test'],
    },
    [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: 'valid-hib-id',
  })

  // expired token (now >= exp)
  manager.serializeInternalAttachment(websocketExpired, {
    [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
      att: { att: true },
      chn: 'test-channel',
      exp: nowSec - 1,
      iat: nowSec - 10,
      rpc: ['test'],
    },
    [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: 'expired-hib-id',
  })

  await manager.publishEvent([websocketValid, websocketExpired], { test: 'event1' })

  // valid ws receives one event
  expect(encodeHibernationRPCEventSpy).toHaveBeenCalledTimes(1)
  expect(websocketValid.send).toHaveBeenCalledTimes(1)
  expect((websocketValid as any).close).not.toHaveBeenCalled()

  // expired ws is closed with the "expired" code and doesn't send
  expect((websocketExpired as any).close).toHaveBeenCalledTimes(1)
  expect((websocketExpired as any).close).toHaveBeenCalledWith(4001, 'token expired')
  expect(websocketExpired.send).not.toHaveBeenCalled()

  vi.useRealTimers()
})

it('sendEventsAfter closes and skips sending when token is expired', async () => {
  vi.useFakeTimers()
  const fixedNow = new Date('2025-01-01T00:00:00Z')
  vi.setSystemTime(fixedNow)
  const nowSec = Math.floor(fixedNow.getTime() / 1000)

  const ctx = createDurableObjectState()
  const storage = new DurableEventIteratorObjectEventStorage(ctx)
  const websocket = createCloudflareWebsocket()
  const options = { customJsonSerializers: [] }

  // ensure `close` is a mock so we can assert on it
  ;(websocket as any).close = vi.fn()

  const manager = new DurableEventIteratorObjectWebsocketManager<any, any, any>(
    ctx,
    storage,
    options,
  )

  manager.serializeInternalAttachment(websocket, {
    [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: {
      att: { att: true },
      chn: 'test-channel',
      exp: nowSec - 1, // expired
      iat: nowSec - 10,
      rpc: ['test'],
    },
    [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: 'hib-123',
  })

  // seed some events (should not be sent)
  storage.storeEvent({ test: 'event1' })
  storage.storeEvent({ test: 'event2' })

  await manager.sendEventsAfter(websocket, 'hib-123', '0')

  // no encode/sends happen, socket is closed for expiry
  expect(encodeHibernationRPCEventSpy).not.toHaveBeenCalled()
  expect(websocket.send).not.toHaveBeenCalled()
  expect((websocket as any).close).toHaveBeenCalledTimes(1)
  expect((websocket as any).close).toHaveBeenCalledWith(4001, 'token expired')

  vi.useRealTimers()
})
