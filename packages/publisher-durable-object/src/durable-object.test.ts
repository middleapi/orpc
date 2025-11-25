import { sleep } from '@orpc/shared'
import { createDurableObjectState, createWebSocket } from '../tests/shared'
import { PublisherDurableObject } from './durable-object'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected readonly ctx: any, protected readonly env: unknown) {}
  },
}))

// Mock WebSocketPair globally for Cloudflare Workers environment
let mockServerWebSocket: any = null
;(globalThis as any).WebSocketPair = class {
  '0': WebSocket
  '1': WebSocket
  constructor() {
    const serverWs = mockServerWebSocket ?? createWebSocket()
    this['0'] = { close: vi.fn() } as any
    this['1'] = serverWs
  }
}

// Mock Response to support status 101 with webSocket (Cloudflare-specific)
const OriginalResponse = globalThis.Response
class MockResponse extends OriginalResponse {
  webSocket?: WebSocket
  constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: WebSocket }) {
    // Use 200 for the actual Response to avoid the range error
    const status = init?.status === 101 ? 200 : init?.status
    super(body, { ...init, status })
    // Store the intended status for assertions
    Object.defineProperty(this, 'status', { value: init?.status ?? 200 })
    this.webSocket = init?.webSocket
  }
}
;(globalThis as any).Response = MockResponse

beforeEach(() => {
  mockServerWebSocket = null
})

describe('publisherDurableObject', () => {
  describe('resume disabled (default)', () => {
    it('does not create schema when resume is disabled', () => {
      const ctx = createDurableObjectState()
      void new PublisherDurableObject(ctx, {})

      expect(ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()).toEqual([])
      expect(ctx.storage.setAlarm).not.toHaveBeenCalled()
    })

    it('can publishes messages', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {})
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      const message = JSON.stringify({ data: { json: 'data' }, meta: { comments: ['test'] } })
      const request = new Request('http://localhost/publish', {
        method: 'POST',
        body: message,
      })

      const response = await durable.fetch(request)

      expect(response.status).toBe(204)
      expect(ws.send).toHaveBeenCalledWith(message)
    })

    it('can subscribes', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {})

      const request = new Request('http://localhost/subscribe', {
        headers: { 'last-event-id': '0' },
      })

      const response = await durable.fetch(request)

      expect(ctx.acceptWebSocket).toHaveBeenCalled()
      expect(response.status).toBe(101)
      expect((response as any).webSocket).toBeDefined()
    })
  })

  describe('resume enabled', () => {
    it('creates schema and schedules alarm on first init', () => {
      const ctx = createDurableObjectState()
      void new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })

      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('orpc:publisher:resume:events')
      expect(ctx.waitUntil).toHaveBeenCalled()
      expect(ctx.storage.setAlarm).toHaveBeenCalled()
    })

    it('cleans up expired events on subsequent init (not first time)', () => {
      const ctx = createDurableObjectState()
      // First init creates table
      void new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })

      ctx.waitUntil.mockClear()
      ctx.storage.setAlarm.mockClear()

      // Second init should cleanup, not schedule alarm
      void new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })

      expect(ctx.waitUntil).not.toHaveBeenCalled()
      expect(ctx.storage.setAlarm).not.toHaveBeenCalled()
    })

    it('stores events with auto-generated IDs', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event1' }),
      }))

      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event2', meta: { retry: 1000, id: 'should be overwritten' } }),
      }))

      expect(ws.send).toHaveBeenNthCalledWith(1, '{"data":"event1","meta":{"id":"1"}}')
      expect(ws.send).toHaveBeenNthCalledWith(2, '{"data":"event2","meta":{"retry":1000,"id":"2"}}')

      const stored = ctx.storage.sql.exec('SELECT * FROM "orpc:publisher:resume:events"').toArray()
      expect(stored).toHaveLength(2)
    })

    it('replays events from lastEventId', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const publisher = createWebSocket()
      ctx.acceptWebSocket(publisher)

      // Store some events
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event1' }),
      }))
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event2' }),
      }))
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event3' }),
      }))

      // New subscriber with lastEventId = 1 should get events 2 and 3
      const subscriber = createWebSocket()
      // Mock WebSocketPair
      const originalWebSocketPair = (globalThis as any).WebSocketPair
      ;(globalThis as any).WebSocketPair = class {
        '0': WebSocket
        '1': WebSocket
        constructor() {
          this['0'] = {} as WebSocket
          this['1'] = subscriber
        }
      }

      await durable.fetch(new Request('http://localhost/subscribe', {
        headers: { 'last-event-id': '1' },
      }))

      ;(globalThis as any).WebSocketPair = originalWebSocketPair

      expect(subscriber.send).toHaveBeenCalledTimes(2)
      expect(subscriber.send).toHaveBeenNthCalledWith(1, '{"data":"event2","meta":{"id":"2"}}')
      expect(subscriber.send).toHaveBeenNthCalledWith(2, '{"data":"event3","meta":{"id":"3"}}')
    })

    it('handles replay errors gracefully', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const publisher = createWebSocket()
      ctx.acceptWebSocket(publisher)

      // Store some events
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event1' }),
      }))
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event2' }),
      }))

      // New subscriber that throws on send
      const subscriber = createWebSocket()
      subscriber.send.mockImplementation(() => {
        throw new Error('WebSocket closed')
      })

      const originalWebSocketPair = (globalThis as any).WebSocketPair
      ;(globalThis as any).WebSocketPair = class {
        '0': WebSocket
        '1': WebSocket
        constructor() {
          this['0'] = {} as WebSocket
          this['1'] = subscriber
        }
      }

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await durable.fetch(new Request('http://localhost/subscribe', {
        headers: { 'last-event-id': '0' },
      }))

      ;(globalThis as any).WebSocketPair = originalWebSocketPair

      // Should have tried to send both events and logged errors
      expect(subscriber.send).toHaveBeenCalledTimes(2)
      expect(consoleSpy).toHaveBeenCalledWith('Failed to replay event to websocket:', expect.any(Error))

      consoleSpy.mockRestore()
    })

    it('expires events after retention period', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 1 })
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event1' }),
      }))

      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)

      await sleep(2000)

      // Trigger cleanup via another publish
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event2' }),
      }))

      // First event should be expired, only second remains
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)
    })

    it('resets schema on ID overflow', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      // Simulate ID near overflow by inserting a high ID
      ctx.storage.sql.exec(
        `INSERT INTO "orpc:publisher:resume:events" (id, payload) VALUES (?, ?)`,
        '9223372036854775807',
        '{"data":"old"}',
      )
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)

      // Next insert should trigger reset
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'new' }),
      }))

      // Should have reset and only have the new event
      expect(ctx.storage.sql.exec('SELECT count(*) as count FROM "orpc:publisher:resume:events"').one().count).toBe(1)
      expect(ws.send).toHaveBeenLastCalledWith('{"data":"new","meta":{"id":"1"}}')
    })

    it('supports custom schema prefix', () => {
      const ctx = createDurableObjectState()
      void new PublisherDurableObject(ctx, {}, {
        resumeRetentionSeconds: 60,
        resumeSchemaPrefix: 'custom:prefix:',
      })

      const tables = ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=?', 'table').toArray()
      expect(tables.map((t: any) => t.name)).toContain('custom:prefix:events')
    })
  })

  describe('alarm behavior', () => {
    it('reschedules alarm when there are active connections', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      ctx.storage.setAlarm.mockClear()
      await durable.alarm()

      expect(ctx.storage.setAlarm).toHaveBeenCalled()
      expect(ctx.storage.deleteAll).not.toHaveBeenCalled()
    })

    it('reschedules alarm when there are recent events', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      // Store an event
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event' }),
      }))

      // Remove websocket to simulate disconnect
      ctx.getWebSockets.mockReturnValue([])
      ctx.storage.setAlarm.mockClear()

      await durable.alarm()

      expect(ctx.storage.setAlarm).toHaveBeenCalled()
      expect(ctx.storage.deleteAll).not.toHaveBeenCalled()
    })

    it('deletes all data when inactive', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 1 })
      const ws = createWebSocket()
      ctx.acceptWebSocket(ws)

      // Store an event
      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'event' }),
      }))

      // Disconnect and wait for expiry
      ctx.getWebSockets.mockReturnValue([])
      await sleep(2000)

      ctx.storage.setAlarm.mockClear()
      await durable.alarm()

      expect(ctx.storage.deleteAll).toHaveBeenCalled()
      expect(ctx.storage.setAlarm).not.toHaveBeenCalled()
    })

    it('still works when resume is disabled after being enabled', async () => {
      const ctx = createDurableObjectState()
      void new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: 60 })
      const durable = new PublisherDurableObject(ctx, {}, { resumeRetentionSeconds: Number.NaN })

      await durable.alarm()

      expect(ctx.storage.deleteAll).toHaveBeenCalled()
    })
  })

  describe('publish/subscribe flow', () => {
    it('broadcasts to all connected websockets', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {})

      const ws1 = createWebSocket()
      const ws2 = createWebSocket()
      const ws3 = createWebSocket()
      ctx.acceptWebSocket(ws1)
      ctx.acceptWebSocket(ws2)
      ctx.acceptWebSocket(ws3)

      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'broadcast' }),
      }))

      expect(ws1.send).toHaveBeenCalledWith('{"data":"broadcast"}')
      expect(ws2.send).toHaveBeenCalledWith('{"data":"broadcast"}')
      expect(ws3.send).toHaveBeenCalledWith('{"data":"broadcast"}')
    })

    it('handles websocket send errors gracefully', async () => {
      const ctx = createDurableObjectState()
      const durable = new PublisherDurableObject(ctx, {})

      const ws1 = createWebSocket()
      const ws2 = createWebSocket()
      ws1.send.mockImplementation(() => {
        throw new Error('WebSocket closed')
      })
      ctx.acceptWebSocket(ws1)
      ctx.acceptWebSocket(ws2)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await durable.fetch(new Request('http://localhost/publish', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      }))

      expect(consoleSpy).toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalledWith('{"data":"test"}')

      consoleSpy.mockRestore()
    })
  })
})
