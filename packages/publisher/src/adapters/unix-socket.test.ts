import type { UnixSocketPublisherServerOptions } from './unix-socket'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { compareSequentialIds } from '@orpc/shared'
import { getEventMeta, withEventMeta } from '@standard-server/core'
import { WebSocket, WebSocketServer } from 'ws'
import { UnixSocketPublisher, UnixSocketPublisherServer } from './unix-socket'

type TestEvents = Record<string, { order: number } & Record<string, unknown>>

describe('unixSocketPublisher', () => {
  let dir: string
  let pathCount = 0
  const cleanups: Array<() => Promise<unknown>> = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orpc-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(cleanups.splice(0).map(cleanup => cleanup().catch(() => {})))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // Kept short, since socket paths are limited to about 100 characters.
  function createSocketPath(): string {
    return join(dir, `${pathCount++}.sock`)
  }

  async function createTestingServer(options?: UnixSocketPublisherServerOptions, path = createSocketPath()) {
    const server = new UnixSocketPublisherServer(options)
    await server.listen(path)
    cleanups.push(() => server.close())

    return { server, path }
  }

  function createTestingPublisher(path: string) {
    return new UnixSocketPublisher<TestEvents>(path)
  }

  function connectRaw(path: string): Promise<WebSocket> {
    const ws = new WebSocket('ws://localhost', { createConnection: () => connect(path) })
    cleanups.push(async () => ws.terminate())

    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws))
      ws.once('error', reject)
    })
  }

  function nextMessage(ws: WebSocket): Promise<any> {
    return new Promise(resolve => ws.once('message', data => resolve(JSON.parse(String(data)))))
  }

  function nextClose(ws: WebSocket): Promise<{ code: number, reason: string }> {
    return new Promise(resolve => ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })))
  }

  /**
   * A server speaking the protocol by hand, to reach client states the real server never produces.
   */
  async function createFakeServer(onMessage: (ws: WebSocket, message: any) => void) {
    const path = createSocketPath()
    const httpServer = createServer()
    const wss = new WebSocketServer({ server: httpServer })

    wss.on('connection', (ws) => {
      ws.on('message', data => onMessage(ws, JSON.parse(String(data))))
    })

    await new Promise<void>(resolve => httpServer.listen(path, resolve))

    cleanups.push(async () => {
      wss.clients.forEach(ws => ws.terminate())
      await new Promise(resolve => httpServer.close(resolve))
    })

    return { path, wss }
  }

  function getConnection(publisher: UnixSocketPublisher<any>): any {
    return (publisher as any).connection
  }

  it('delivers live events and meta across publishers (without resume)', async () => {
    const { path } = await createTestingServer()
    const publisher = createTestingPublisher(path)
    const subscriber = createTestingPublisher(path)
    const listener = vi.fn()

    const unsubscribe = await subscriber.subscribe('orders', listener)

    await publisher.publish('ignored', { order: 99 })
    await publisher.publish('orders', { order: 1, date: new Date(0), big: 1n, set: new Set([1]) })
    await publisher.publish('orders', withEventMeta({ order: 2 }, { id: '__id__', comments: ['__comment__'] }))

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2)
    })

    expect(listener).toHaveBeenNthCalledWith(1, expect.toSatisfy((payload) => {
      expect(payload).toEqual({ order: 1, date: new Date(0), big: 1n, set: new Set([1]) })
      expect(getEventMeta(payload)).toEqual(undefined)

      return true
    }))

    expect(listener).toHaveBeenNthCalledWith(2, expect.toSatisfy((payload) => {
      expect(payload).toEqual({ order: 2 })
      expect(getEventMeta(payload)).toEqual({ id: '__id__', comments: ['__comment__'] })

      return true
    }))

    await unsubscribe()
    await unsubscribe() // safe to call twice

    await publisher.publish('orders', { order: 3 })

    // lastEventId is ignored without resume
    const resumeAttempt = vi.fn()
    const unsubscribeResumeAttempt = await subscriber.subscribe('orders', resumeAttempt, { lastEventId: '0' })

    // a round trip through the server delivers anything still in flight
    await subscriber.publish('ignored', { order: 99 })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(resumeAttempt).not.toHaveBeenCalled()

    await unsubscribeResumeAttempt()
  })

  it('sends one message per connection and fans it out to each subscription', async () => {
    const { path, server } = await createTestingServer()
    const publisher = createTestingPublisher(path)
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = await publisher.subscribe('orders', first)
    const unsubscribeSecond = await publisher.subscribe('orders', second)

    const messages = vi.fn()
    getConnection(publisher).ws.on('message', messages)

    await publisher.publish('orders', { order: 1 })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(messages).toHaveBeenCalledTimes(2) // the event and the publish ack

    await unsubscribeFirst()
    await publisher.publish('orders', { order: 2 })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    await unsubscribeSecond()
    await publisher.publish('orders', { order: 3 })

    expect(second).toHaveBeenCalledTimes(2)
    expect((server as any).subscribers.size).toBe(0)
  })

  it('lets a listener unsubscribe another subscription mid-dispatch', async () => {
    const { path } = await createTestingServer()
    const publisher = createTestingPublisher(path)
    const second = vi.fn()

    let unsubscribeSecond: () => Promise<void> = async () => {}
    const unsubscribeFirst = await publisher.subscribe('orders', () => unsubscribeSecond())
    unsubscribeSecond = await publisher.subscribe('orders', second)

    await publisher.publish('orders', { order: 1 })

    expect(second).not.toHaveBeenCalled()

    await unsubscribeFirst()
  })

  it('supports AsyncIteratorObject subscribers with abort signals', async () => {
    const { path, server } = await createTestingServer()
    const publisher = createTestingPublisher(path)
    const controller = new AbortController()

    const iterator = publisher.subscribe('orders', { signal: controller.signal })

    await vi.waitFor(() => {
      expect((server as any).subscribers.size).toBe(1)
    })

    await publisher.publish('orders', { order: 1 })
    await publisher.publish('orders', { order: 2 })

    expect(await iterator.next()).toEqual({ done: false, value: { order: 1 } })
    expect(await iterator.next()).toEqual({ done: false, value: { order: 2 } })

    controller.abort()

    await vi.waitFor(() => {
      expect((server as any).subscribers.size).toBe(0)
    })
  })

  it('reports listener errors through onError', async () => {
    const { path } = await createTestingServer()
    const publisher = createTestingPublisher(path)
    const error = new Error('listener failed')
    const onError = vi.fn()

    const unsubscribe = await publisher.subscribe('orders', () => {
      throw error
    }, { onError })

    await publisher.publish('orders', { order: 1 })

    expect(onError).toHaveBeenCalledWith(error)

    await unsubscribe()
  })

  describe('with resume enabled', () => {
    it('resumes only events after lastEventId and rewrites event ids', async () => {
      const { path } = await createTestingServer({ resume: { enabled: true } })
      const publisher = createTestingPublisher(path)
      const liveListener = vi.fn()

      const unsubscribeLive = await publisher.subscribe('orders', liveListener)

      await publisher.publish('orders', { order: 1 })
      await publisher.publish('orders', withEventMeta({ order: 2 }, { id: 'client-id', comments: ['audit-log'] }))
      await publisher.publish('orders', { order: 3 })

      expect(liveListener).toHaveBeenCalledTimes(3)

      const [first, second, third] = liveListener.mock.calls.map(([payload]) => payload)
      const ids = [first, second, third].map(payload => getEventMeta(payload)?.id)

      expect(second).toEqual({ order: 2 })
      expect(getEventMeta(second)).toEqual({ id: ids[1], comments: ['audit-log'] })
      expect(ids[1]).not.toBe('client-id')
      expect(compareSequentialIds(ids[0]!, ids[1]!)).toBeLessThan(0)
      expect(compareSequentialIds(ids[1]!, ids[2]!)).toBeLessThan(0)

      const subscriber = createTestingPublisher(path)

      const resumed = vi.fn()
      const unsubscribeResumed = await subscriber.subscribe('orders', resumed, { lastEventId: ids[1] })

      // replayed events arrive before subscribe resolves
      expect(resumed).toHaveBeenCalledTimes(1)
      expect(resumed).toHaveBeenCalledWith(third)
      expect(getEventMeta(resumed.mock.calls[0]![0])).toEqual({ id: ids[2] })

      await publisher.publish('orders', { order: 4 })

      await vi.waitFor(() => {
        expect(resumed).toHaveBeenCalledTimes(2)
      })

      expect(resumed).toHaveBeenLastCalledWith({ order: 4 })

      const emptyResume = vi.fn()
      const unsubscribeEmptyResume = await subscriber.subscribe('notices', emptyResume, { lastEventId: '0' })

      const afterTail = vi.fn()
      const unsubscribeAfterTail = await subscriber.subscribe('orders', afterTail, {
        lastEventId: getEventMeta(resumed.mock.calls[1]![0])?.id,
      })

      expect(emptyResume).not.toHaveBeenCalled()
      expect(afterTail).not.toHaveBeenCalled()

      await unsubscribeLive()
      await unsubscribeResumed()
      await unsubscribeEmptyResume()
      await unsubscribeAfterTail()
    })

    it('delivers every event exactly once in order while resuming during concurrent publishes', async () => {
      const { path } = await createTestingServer({ resume: { enabled: true } })
      const publisher = createTestingPublisher(path)
      const first = vi.fn()

      const unsubscribeFirst = await publisher.subscribe('orders', first)
      await publisher.publish('orders', { order: 0 })

      const lastEventId = getEventMeta(first.mock.calls[0]![0])?.id

      const subscriber = createTestingPublisher(path)
      const resumed = vi.fn()

      const publishes: Promise<void>[] = []
      for (let order = 1; order <= 100; order++) {
        publishes.push(publisher.publish('orders', { order }))
      }

      const unsubscribeResumed = await subscriber.subscribe('orders', resumed, { lastEventId })

      for (let order = 101; order <= 200; order++) {
        publishes.push(publisher.publish('orders', { order }))
      }

      await Promise.all(publishes)

      await vi.waitFor(() => {
        expect(resumed).toHaveBeenCalledTimes(200)
      })

      expect(resumed.mock.calls.map(([payload]) => payload.order)).toEqual(
        Array.from({ length: 200 }, (_, i) => i + 1),
      )

      await unsubscribeFirst()
      await unsubscribeResumed()
    })

    it('expires old events lazily', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

      const { path } = await createTestingServer({ resume: { enabled: true, seconds: 1 } })
      const publisher = createTestingPublisher(path)

      await publisher.publish('orders', { order: 1 })
      await publisher.publish('notices', { order: 1 })

      vi.advanceTimersByTime(500)

      await publisher.publish('notices', { order: 2 })

      const beforeExpiry = vi.fn()
      await (await publisher.subscribe('notices', beforeExpiry, { lastEventId: '0' }))()

      expect(beforeExpiry.mock.calls.map(([payload]) => payload)).toEqual([{ order: 1 }, { order: 2 }])

      vi.advanceTimersByTime(500)

      await publisher.publish('orders', { order: 2 })

      const orders = vi.fn()
      const notices = vi.fn()
      await (await publisher.subscribe('orders', orders, { lastEventId: '0' }))()
      await (await publisher.subscribe('notices', notices, { lastEventId: '0' }))()

      expect(orders.mock.calls.map(([payload]) => payload)).toEqual([{ order: 2 }])
      expect(notices.mock.calls.map(([payload]) => payload)).toEqual([{ order: 2 }])
    })

    it('keeps ids increasing across server restarts so subscribers can resume', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

      const first = await createTestingServer({ resume: { enabled: true } })
      const publisher = createTestingPublisher(first.path)
      const listener = vi.fn()

      const unsubscribe = await publisher.subscribe('orders', listener)

      // many more events than milliseconds pass before the restart
      for (let order = 1; order <= 100; order++) {
        await publisher.publish('orders', { order })
      }

      await unsubscribe()
      await first.server.close()

      vi.advanceTimersByTime(1)

      await createTestingServer({ resume: { enabled: true } }, first.path)
      await publisher.publish('orders', { order: 101 })

      const resumed = vi.fn()
      const unsubscribeResumed = await publisher.subscribe('orders', resumed, {
        lastEventId: getEventMeta(listener.mock.calls[99]![0])?.id,
      })

      expect(resumed).toHaveBeenCalledTimes(1)
      expect(resumed).toHaveBeenCalledWith({ order: 101 })

      await unsubscribeResumed()
    })
  })

  describe('connection', () => {
    it('fails operations when no server is listening', async () => {
      const publisher = createTestingPublisher(createSocketPath())

      await expect(publisher.publish('orders', { order: 1 })).rejects.toThrow(/Failed to connect to the publisher server at ".*"/)
      await expect(publisher.subscribe('orders', () => {})).rejects.toSatisfy((error: Error) => {
        expect((error.cause as any).code).toBe('ENOENT')
        return true
      })

      const iterator = publisher.subscribe('orders')
      await expect(iterator.next()).rejects.toThrow(/Failed to connect/)
    })

    it('fails active subscriptions when the server closes and reconnects afterwards', async () => {
      const { path, server } = await createTestingServer()
      const publisher = createTestingPublisher(path)
      const onError = vi.fn()

      await publisher.subscribe('orders', () => {}, { onError })
      const iterator = publisher.subscribe('notices')
      const next = iterator.next()

      await vi.waitFor(() => {
        expect((server as any).subscribers.size).toBe(2)
      })

      await server.close()

      await expect(next).rejects.toThrow('Connection to the publisher server at')
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0]![0].message).toContain('closed: 1001 Server closing')

      await createTestingServer(undefined, path)

      const listener = vi.fn()
      const unsubscribe = await publisher.subscribe('orders', listener)
      await publisher.publish('orders', { order: 1 })

      expect(listener).toHaveBeenCalledWith({ order: 1 })

      await unsubscribe()
    })

    it('rejects pending requests when the connection closes', async () => {
      const { path } = await createFakeServer(ws => ws.close(1011, 'Unavailable'))
      const publisher = createTestingPublisher(path)

      await expect(publisher.publish('orders', { order: 1 })).rejects.toThrow('closed: 1011 Unavailable')
      await expect(publisher.subscribe('orders', () => {})).rejects.toThrow('closed: 1011 Unavailable')
    })

    it('rejects requests the server answers with an error', async () => {
      const { path } = await createFakeServer((ws, message) => {
        ws.send(JSON.stringify({ type: 'error', id: message.id, message: 'Something went wrong' }))
      })
      const publisher = createTestingPublisher(path)

      await expect(publisher.publish('orders', { order: 1 })).rejects.toThrow('Something went wrong')
      await expect(publisher.subscribe('orders', () => {})).rejects.toThrow('Something went wrong')

      expect(getConnection(publisher).subscriptions.size).toBe(0)
    })

    it.each([
      ['an invalid JSON message', 'not json', false],
      ['a binary message', '{}', true],
    ])('closes the connection on %s from the server', async (_, data, binary) => {
      const { path } = await createFakeServer(ws => ws.send(data, { binary }))
      const publisher = createTestingPublisher(path)

      await expect(publisher.publish('orders', { order: 1 })).rejects.toSatisfy((error: Error) => {
        expect(error.message).toContain('closed: 1007 Invalid message')
        expect((error.cause as Error).message).toBe('Received an invalid message from the publisher server')
        return true
      })
    })

    it('ignores messages for unknown requests and subscriptions', async () => {
      const { path } = await createFakeServer((ws, message) => {
        ws.send(JSON.stringify({ type: 'ack', id: 999 }))
        ws.send(JSON.stringify({ type: 'replay', id: 999, data: { payload: { json: { order: 0 } } } }))
        ws.send(JSON.stringify({ type: 'event', event: 'unknown', data: { payload: { json: { order: 0 } } } }))
        ws.send(JSON.stringify({ type: 'unknown', id: message.id }))
        ws.send(JSON.stringify({ type: 'ack', id: message.id }))
      })
      const publisher = createTestingPublisher(path)

      await expect(publisher.publish('orders', { order: 1 })).resolves.toBeUndefined()
    })

    it('keeps the process alive only while subscriptions or requests are pending', async () => {
      const acks: Array<() => void> = []
      const { path } = await createFakeServer((ws, message) => {
        acks.push(() => ws.send(JSON.stringify({ type: 'ack', id: message.id })))
      })
      const publisher = createTestingPublisher(path)
      const hasRef = () => getConnection(publisher).socket._handle.hasRef()

      const publishing = publisher.publish('orders', { order: 1 })

      await vi.waitFor(() => {
        expect(acks).toHaveLength(1)
      })

      expect(hasRef()).toBe(true)

      acks.shift()!()
      await publishing

      expect(hasRef()).toBe(false)

      const subscribing = publisher.subscribe('orders', () => {})

      await vi.waitFor(() => {
        expect(acks).toHaveLength(1)
      })

      acks.shift()!()
      const unsubscribe = await subscribing

      expect(hasRef()).toBe(true)

      await unsubscribe()

      expect(hasRef()).toBe(false)
    })
  })

  describe('server', () => {
    it('replaces a stale socket file', async () => {
      const path = createSocketPath()

      // A process killed while listening leaves its socket file behind.
      spawnSync(process.execPath, [
        '-e',
        `require('node:net').createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, 'SIGKILL'))`,
      ])

      expect((await stat(path)).isSocket()).toBe(true)

      const { server } = await createTestingServer(undefined, path)
      const publisher = createTestingPublisher(path)
      const listener = vi.fn()

      await publisher.subscribe('orders', listener)
      await publisher.publish('orders', { order: 1 })

      expect(listener).toHaveBeenCalledTimes(1)

      await server.close()
    })

    it('does not replace a socket in use or other files', async () => {
      const { path } = await createTestingServer()

      await expect(new UnixSocketPublisherServer().listen(path)).rejects.toMatchObject({ code: 'EADDRINUSE' })

      const filePath = createSocketPath()
      await writeFile(filePath, 'important')

      await expect(new UnixSocketPublisherServer().listen(filePath)).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect((await stat(filePath)).isFile()).toBe(true)
    })

    it('rejects listening on an invalid path', async () => {
      await expect(new UnixSocketPublisherServer().listen(join(dir, 'missing', 'x.sock'))).rejects.toMatchObject({ code: 'EACCES' })
    })

    it('rejects plain HTTP requests', async () => {
      const { path } = await createTestingServer()

      const status = await new Promise((resolve, reject) => {
        request({ socketPath: path, path: '/' }, (response) => {
          response.resume()
          resolve(response.statusCode)
        }).on('error', reject).end()
      })

      expect(status).toBe(426)
    })

    it.each([
      ['invalid JSON', 'not json', false],
      ['binary data', '{"type":"publish","id":1}', true],
      ['a non-object message', '[]', false],
      ['a message without a numeric id', '{"type":"publish","id":"1"}', false],
    ])('closes connections sending %s', async (_, data, binary) => {
      const { path } = await createTestingServer()
      const ws = await connectRaw(path)
      const closed = nextClose(ws)

      ws.send(data, { binary })

      expect(await closed).toEqual({ code: 1008, reason: 'Invalid message' })
    })

    it.each([
      ['publish', { event: 1, data: { payload: {} } }],
      ['publish', { event: 'orders', data: 'invalid' }],
      ['publish', { event: 'orders', data: { payload: {}, meta: 'invalid' } }],
      ['subscribe', { event: 1 }],
      ['subscribe', { event: 'orders', lastEventId: 1 }],
      ['unknown', {}],
    ])('answers an invalid %s request with an error', async (type, fields) => {
      const { path } = await createTestingServer()
      const ws = await connectRaw(path)

      ws.send(JSON.stringify({ type, id: 1, ...fields }))

      expect(await nextMessage(ws)).toEqual({ type: 'error', id: 1, message: `Invalid ${type} request` })
    })

    it('rejects reusing a subscription id and ignores unknown unsubscriptions', async () => {
      const { path, server } = await createTestingServer()
      const ws = await connectRaw(path)

      ws.send(JSON.stringify({ type: 'unsubscribe', id: 1 }))
      ws.send(JSON.stringify({ type: 'subscribe', id: 1, event: 'orders' }))
      expect(await nextMessage(ws)).toEqual({ type: 'ack', id: 1 })

      ws.send(JSON.stringify({ type: 'subscribe', id: 1, event: 'orders' }))
      expect(await nextMessage(ws)).toEqual({ type: 'error', id: 1, message: 'Invalid subscribe request' })

      ws.send(JSON.stringify({ type: 'subscribe', id: 2, event: 'notices' }))
      expect(await nextMessage(ws)).toEqual({ type: 'ack', id: 2 })

      expect((server as any).subscribers.size).toBe(2)

      const closed = nextClose(ws)
      ws.close()
      await closed

      await vi.waitFor(() => {
        expect((server as any).connections.size).toBe(0)
      })

      expect((server as any).subscribers.size).toBe(0)
    })
  })
})
