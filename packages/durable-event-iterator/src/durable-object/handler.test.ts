import { call, createProcedureClient } from '@orpc/server'
import { HibernationEventIterator } from '@orpc/server/hibernation'
import { createCloudflareWebsocket, createDurableObjectState } from '../../tests/shared'
import { DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY, DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY } from './consts'
import { DurableEventIteratorObjectEventStorage } from './event-storage'
import { durableEventIteratorRouter } from './handler'
import { DurableEventIteratorObjectWebsocketManager } from './websocket-manager'

describe('durableEventIteratorRouter', async () => {
  const date = Date.now()

  const tokenPayload = {
    att: { some: 'attachment' },
    iat: date,
    exp: date + 1000,
    chn: 'test-channel',
    rpc: ['someMethod'],
  }

  describe('subscribe', async () => {
    it('without last event id', async () => {
      const ctx = createDurableObjectState()
      const currentWebsocket = createCloudflareWebsocket()
      const eventStorage = new DurableEventIteratorObjectEventStorage(ctx)
      const websocketManager = new DurableEventIteratorObjectWebsocketManager(ctx, eventStorage)
      const serializeInternalAttachmentSpy = vi.spyOn(websocketManager, 'serializeInternalAttachment')
      const sendEventsAfterSpy = vi.spyOn(websocketManager, 'sendEventsAfter')

      websocketManager.serializeInternalAttachment(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: tokenPayload,
      })

      const output = await call(durableEventIteratorRouter.subscribe, undefined, {
        context: {
          object: {} as any,
          currentWebsocket,
          websocketManager,
        },
      }) as HibernationEventIterator<any>

      expect(output).toBeInstanceOf(HibernationEventIterator)

      output.hibernationCallback?.('123')

      expect(serializeInternalAttachmentSpy).toHaveBeenCalledWith(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '123',
      })

      expect(sendEventsAfterSpy).toHaveBeenCalledWith(
        currentWebsocket,
        '123',
        new Date((date - 1) * 1000),
      )
    })

    it('with last event id', async () => {
      const ctx = createDurableObjectState()
      const currentWebsocket = createCloudflareWebsocket()
      const eventStorage = new DurableEventIteratorObjectEventStorage(ctx)
      const websocketManager = new DurableEventIteratorObjectWebsocketManager(ctx, eventStorage)
      const serializeInternalAttachmentSpy = vi.spyOn(websocketManager, 'serializeInternalAttachment')
      const sendEventsAfterSpy = vi.spyOn(websocketManager, 'sendEventsAfter')

      websocketManager.serializeInternalAttachment(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: tokenPayload,
      })

      const client = createProcedureClient(durableEventIteratorRouter.subscribe, {
        context: {
          object: {} as any,
          currentWebsocket,
          websocketManager,
        },
      })

      const output = await client(undefined, { lastEventId: '3' }) as HibernationEventIterator<any>

      expect(output).toBeInstanceOf(HibernationEventIterator)

      output.hibernationCallback?.('123')

      expect(serializeInternalAttachmentSpy).toHaveBeenCalledWith(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_HIBERNATION_ID_KEY]: '123',
      })

      expect(sendEventsAfterSpy).toHaveBeenCalledWith(
        currentWebsocket,
        '123',
        '3',
      )
    })
  })

  describe('call', async () => {
    it('reject if method is not allowed', async () => {
      const ctx = createDurableObjectState()
      const currentWebsocket = createCloudflareWebsocket()
      const eventStorage = new DurableEventIteratorObjectEventStorage(ctx)
      const websocketManager = new DurableEventIteratorObjectWebsocketManager(ctx, eventStorage)

      websocketManager.serializeInternalAttachment(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: tokenPayload,
      })

      await expect(call(durableEventIteratorRouter.call, {
        input: 'some-input',
        path: ['notAllowedMethod'],
      }, {
        context: {
          object: {} as any,
          currentWebsocket,
          websocketManager,
        },
      })).rejects.toThrow('Method "notAllowedMethod" is not allowed.')
    })

    it('single client', async () => {
      const ctx = createDurableObjectState()
      const currentWebsocket = createCloudflareWebsocket()
      const eventStorage = new DurableEventIteratorObjectEventStorage(ctx)
      const websocketManager = new DurableEventIteratorObjectWebsocketManager(ctx, eventStorage)

      websocketManager.serializeInternalAttachment(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: tokenPayload,
      })

      const object = {
        someMethod: vi.fn(() => vi.fn(() => 'some-output')),
      }

      const client = createProcedureClient(durableEventIteratorRouter.call, {
        context: {
          object: object as any,
          currentWebsocket,
          websocketManager,
        },
      })

      const signal = new AbortController().signal
      const lastEventId = '3'
      const output = await client({ input: 'some-input', path: ['someMethod'] }, { signal, lastEventId })

      expect(output).toBe('some-output')
      expect(object.someMethod).toHaveBeenCalledWith(currentWebsocket)
      const someMethodClient = object.someMethod.mock.results[0]!.value
      expect(someMethodClient).toBeCalledWith('some-input', { signal, lastEventId })
    })

    it('nested client', async () => {
      const ctx = createDurableObjectState()
      const currentWebsocket = createCloudflareWebsocket()
      const eventStorage = new DurableEventIteratorObjectEventStorage(ctx)
      const websocketManager = new DurableEventIteratorObjectWebsocketManager(ctx, eventStorage)

      websocketManager.serializeInternalAttachment(currentWebsocket, {
        [DURABLE_EVENT_ITERATOR_TOKEN_PAYLOAD_KEY]: tokenPayload,
      })

      const object = {
        someMethod: vi.fn(() => ({
          nested: vi.fn(() => 'some-output'),
        })),
      }

      const client = createProcedureClient(durableEventIteratorRouter.call, {
        context: {
          object: object as any,
          currentWebsocket,
          websocketManager,
        },
      })

      const signal = new AbortController().signal
      const lastEventId = '3'
      const output = await client({ input: 'some-input', path: ['someMethod', 'nested'] }, { signal, lastEventId })

      expect(output).toBe('some-output')
      expect(object.someMethod).toHaveBeenCalledWith(currentWebsocket)
      const someMethodClient = object.someMethod.mock.results[0]!.value.nested
      expect(someMethodClient).toBeCalledWith('some-input', { signal, lastEventId })
    })
  })
})
