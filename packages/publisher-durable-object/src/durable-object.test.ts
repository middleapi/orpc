import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDurableObjectState, createWebSocket } from '../tests/shared'
import { PublisherDurableObject } from './durable-object'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected readonly ctx: any, protected readonly env: unknown) {}
  },
}))

// Mock WebSocketPair globally for Cloudflare Workers environment
let mockServerWebSocket: any = null
let mockClientWebSocket: any = null
;(globalThis as any).WebSocketPair = class {
  '0': WebSocket
  '1': WebSocket
  constructor() {
    const serverWs = mockServerWebSocket ?? createWebSocket()
    const clientWs = mockClientWebSocket ?? { close: vi.fn() }
    this['0'] = clientWs as any
    this['1'] = serverWs
  }
}

// Mock Response to support status 101 with webSocket (Cloudflare-specific)
const OriginalResponse = globalThis.Response
class MockResponse extends OriginalResponse {
  override webSocket: WebSocket | null
  constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: WebSocket }) {
    // Use 200 for the actual Response to avoid the range error
    const status = init?.status === 101 ? 200 : init?.status
    super(body, { ...init, status })
    // Store the intended status for assertions
    Object.defineProperty(this, 'status', { value: init?.status ?? 200 })
    this.webSocket = init?.webSocket ?? null
  }
}
;(globalThis as any).Response = MockResponse

beforeEach(() => {
  mockServerWebSocket = null
  mockClientWebSocket = null
})

describe('publisherDurableObject', () => {
  describe('handlePublish', () => {
    it('should broadcast message to all connected websockets', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {})

      // First, create some websocket connections
      const ws1 = createWebSocket()
      const ws2 = createWebSocket()
      mockServerWebSocket = ws1
      await durableObject.fetch(new Request('https://example.com/subscribe'))
      mockServerWebSocket = ws2
      await durableObject.fetch(new Request('https://example.com/subscribe'))

      // Now publish a message
      const message = JSON.stringify({ data: 'broadcast test' })
      const request = new Request('https://example.com/publish', {
        method: 'POST',
        body: message,
      })

      await durableObject.fetch(request)

      expect(ws1.send).toHaveBeenCalledWith(message)
      expect(ws2.send).toHaveBeenCalledWith(message)
    })

    it('should handle websocket send errors gracefully', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {})

      // Create a websocket that throws on send
      const failingWs = createWebSocket()
      failingWs.send = vi.fn().mockImplementation(() => {
        throw new Error('WebSocket send failed')
      })
      const successWs = createWebSocket()

      mockServerWebSocket = failingWs
      await durableObject.fetch(new Request('https://example.com/subscribe'))
      mockServerWebSocket = successWs
      await durableObject.fetch(new Request('https://example.com/subscribe'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const message = JSON.stringify({ data: 'test' })
      const request = new Request('https://example.com/publish', {
        method: 'POST',
        body: message,
      })

      const response = await durableObject.fetch(request)

      // Should still return 204 even if some websockets fail
      expect(response.status).toBe(204)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to send message to websocket:', expect.any(Error))
      // The successful websocket should still receive the message
      expect(successWs.send).toHaveBeenCalledWith(message)

      consoleErrorSpy.mockRestore()
    })

    it('should work with resume storage enabled', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {}, {
        resume: { retentionSeconds: 60 },
      })

      const ws = createWebSocket()
      mockServerWebSocket = ws
      await durableObject.fetch(new Request('https://example.com/subscribe'))

      const message = JSON.stringify({ meta: {}, payload: { data: 'test' } })
      const request = new Request('https://example.com/publish', {
        method: 'POST',
        body: message,
      })

      const response = await durableObject.fetch(request)

      expect(response.status).toBe(204)
      // Message should be sent with an ID added by resume storage
      expect(ws.send).toHaveBeenCalled()
      const sentMessage = JSON.parse(ws.send.mock.calls[0][0])
      expect(sentMessage.meta.id).toBeDefined()
    })
  })

  describe('handleSubscribe', () => {
    it('should upgrade websocket correctly', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {})

      const serverWs = createWebSocket()
      mockServerWebSocket = serverWs
      const clientWs = createWebSocket()
      mockClientWebSocket = clientWs

      const request = new Request('https://example.com/subscribe')
      const response = await durableObject.fetch(request)

      expect(response.status).toBe(101)
      expect((response as any).webSocket).toBe(clientWs)
      expect(state.acceptWebSocket).toHaveBeenCalledWith(serverWs)
    })

    it('should not replay events when last-event-id header is not provided', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {}, {
        resume: { retentionSeconds: 60 },
      })

      // First publish some messages
      await durableObject.fetch(new Request('https://example.com/publish', {
        method: 'POST',
        body: JSON.stringify({ meta: {}, payload: { data: 'event1' } }),
      }))

      const serverWs = createWebSocket()
      mockServerWebSocket = serverWs

      // Subscribe without last-event-id
      const request = new Request('https://example.com/subscribe')
      await durableObject.fetch(request)

      // Should not replay any events
      expect(serverWs.send).not.toHaveBeenCalled()
    })

    it('should replay events after last-event-id when header is provided', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {}, {
        resume: { retentionSeconds: 60 },
      })

      // First publish some messages
      await durableObject.fetch(new Request('https://example.com/publish', {
        method: 'POST',
        body: JSON.stringify({ meta: {}, payload: { data: 'event1' } }),
      }))
      await durableObject.fetch(new Request('https://example.com/publish', {
        method: 'POST',
        body: JSON.stringify({ meta: {}, payload: { data: 'event2' } }),
      }))
      await durableObject.fetch(new Request('https://example.com/publish', {
        method: 'POST',
        body: JSON.stringify({ meta: {}, payload: { data: 'event3' } }),
      }))

      const serverWs = createWebSocket()
      mockServerWebSocket = serverWs

      // Subscribe with last-event-id = '1' (should get events 2 and 3)
      const request = new Request('https://example.com/subscribe', {
        headers: { 'last-event-id': '1' },
      })
      await durableObject.fetch(request)

      expect(serverWs.send).toHaveBeenCalledTimes(2)
      const event2 = JSON.parse(serverWs.send.mock.calls[0][0])
      const event3 = JSON.parse(serverWs.send.mock.calls[1][0])
      expect(event2.payload.data).toBe('event2')
      expect(event3.payload.data).toBe('event3')
    })

    it('should handle replay send errors gracefully', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {}, {
        resume: { retentionSeconds: 60 },
      })

      // First publish some messages
      await durableObject.fetch(new Request('https://example.com/publish', {
        method: 'POST',
        body: JSON.stringify({ meta: {}, payload: { data: 'event1' } }),
      }))
      await durableObject.fetch(new Request('https://example.com/publish', {
        method: 'POST',
        body: JSON.stringify({ meta: {}, payload: { data: 'event2' } }),
      }))

      const serverWs = createWebSocket()
      let callCount = 0
      serverWs.send = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('Failed to send')
        }
      })
      mockServerWebSocket = serverWs

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const request = new Request('https://example.com/subscribe', {
        headers: { 'last-event-id': '0' },
      })
      const response = await durableObject.fetch(request)

      // Should still complete and return 101
      expect(response.status).toBe(101)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to replay event to websocket:', expect.any(Error))
      // Should have attempted to send both events
      expect(serverWs.send).toHaveBeenCalledTimes(2)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('alarm', () => {
    it('should forward to resume storage alarm', async () => {
      const state = createDurableObjectState()
      const durableObject = new PublisherDurableObject(state, {}, {
        resume: { retentionSeconds: 60 },
      })

      await durableObject.alarm()

      // Should delete all since no websockets and no events
      expect(state.storage.deleteAll).toHaveBeenCalled()
    })
  })
})
