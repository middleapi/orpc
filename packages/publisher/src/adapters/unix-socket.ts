import type { RPCJsonSerialization } from '@orpc/client'
import type { Public, ThrowableError } from '@orpc/shared'
import type { EventMeta } from '@standard-server/core'
import type { Server } from 'node:http'
import type { Socket } from 'node:net'
import type { RawData } from 'ws'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '../publisher'
import { lstat, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { RPCJsonSerializer } from '@orpc/client'
import { compareSequentialIds, isPlainObject, once, promiseWithResolvers, stringifyJSON } from '@orpc/shared'
import { unwrapEvent, withEventMeta } from '@standard-server/core'
import { WebSocket, WebSocketServer } from 'ws'
import { Publisher } from '../publisher'

/**
 * Wire protocol: every WebSocket message is a JSON text frame.
 *
 * Requests (`publish`, `subscribe`) are answered with an `ack` or an `error` carrying the same `id`.
 * A `subscribe` request's `id` also identifies the subscription: missed events are sent as
 * `replay` messages before its `ack`, and live events are sent once per connection and event
 * as `event` messages, after which the client fans them out to its own subscriptions.
 */
type ClientMessage
  = | { type: 'publish', id: number, event: string, data: SerializedEvent }
    | { type: 'subscribe', id: number, event: string, lastEventId?: string | undefined }
    | { type: 'unsubscribe', id: number }

type ServerMessage
  = | { type: 'ack', id: number }
    | { type: 'error', id: number, message: string }
    | { type: 'replay', id: number, data: SerializedEvent }
    | { type: 'event', event: string, data: SerializedEvent }

interface SerializedEvent {
  payload: RPCJsonSerialization
  meta?: undefined | EventMeta
}

export interface UnixSocketPublisherOptions extends PublisherOptions {
  /**
   * Serializer for serialize and deserialize payloads.
   *
   * @default RPCJsonSerializer
   */
  serializer?: undefined | Public<RPCJsonSerializer>
}

/**
 * Publisher adapter that distributes events across processes on the same machine through a
 * `UnixSocketPublisherServer`, speaking WebSocket over a Unix domain socket (or a Windows named pipe).
 *
 * @remarks
 * **Note**: Connects lazily, and keeps the process alive only while subscriptions or requests are pending.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class UnixSocketPublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly serializer: Public<RPCJsonSerializer>
  private connection: UnixSocketPublisherConnection | undefined

  constructor(
    private readonly path: string,
    { serializer, ...options }: UnixSocketPublisherOptions = {},
  ) {
    super(options)

    this.serializer = serializer ?? new RPCJsonSerializer()
  }

  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const [original, meta] = unwrapEvent(payload)
    const { json, meta: jsonMeta } = this.serializer.serialize(original)

    const connection = await this.connect()
    await connection.publish(event, { payload: { json, meta: jsonMeta }, meta })
  }

  protected async subscribeListener<K extends keyof T & string>(
    event: K,
    listener: (payload: T[K]) => void,
    { lastEventId, onError }: PublisherSubscribeListenerOptions = {},
  ): Promise<() => Promise<void>> {
    const connection = await this.connect()

    return connection.subscribe(event, lastEventId, ({ payload, meta }) => {
      try {
        listener(withEventMeta(this.serializer.deserialize(payload) as object, { ...meta }) as T[K])
      }
      catch (error) {
        onError?.(error as ThrowableError)
      }
    }, onError)
  }

  private async connect(): Promise<UnixSocketPublisherConnection> {
    if (!this.connection || this.connection.isClosed) {
      this.connection = new UnixSocketPublisherConnection(this.path)
    }

    const connection = this.connection
    await connection.ready

    return connection
  }
}

interface ClientSubscription {
  isActive: boolean
  deliver: (data: SerializedEvent) => void
  onError: ((error: ThrowableError) => void) | undefined
}

/**
 * A single WebSocket connection to the server, multiplexing every request and subscription
 * of a publisher. Once closed, its subscriptions fail and the publisher opens a new connection.
 */
class UnixSocketPublisherConnection {
  readonly ready: Promise<void>

  private readonly ws: WebSocket
  private socket: Socket | undefined
  private lastError: Error | undefined
  private lastRequestId = 0

  private readonly pendingRequests = new Map<number, { resolve: () => void, reject: (error: Error) => void }>()
  private readonly subscriptions = new Map<number, ClientSubscription>()
  private readonly activeSubscriptions = new Map<string, Set<ClientSubscription>>()

  constructor(path: string) {
    const ready = promiseWithResolvers<void>()
    this.ready = ready.promise

    let isOpen = false

    this.ws = new WebSocket('ws://localhost', {
      createConnection: () => this.socket = connect(path),
      perMessageDeflate: false,
    })

    this.ws.on('open', () => {
      isOpen = true
      ready.resolve()
    })

    this.ws.on('error', (error) => {
      this.lastError = error
    })

    this.ws.on('message', (data, isBinary) => {
      this.handleMessage(data, isBinary)
    })

    this.ws.on('close', (code, reason) => {
      const error = isOpen
        ? new Error(`Connection to the publisher server at "${path}" closed: ${code} ${reason}`.trimEnd(), { cause: this.lastError })
        : new Error(`Failed to connect to the publisher server at "${path}"`, { cause: this.lastError })

      ready.reject(error)

      const requests = [...this.pendingRequests.values()]
      const subscriptions = [...this.subscriptions.values()]

      this.pendingRequests.clear()
      this.subscriptions.clear()
      this.activeSubscriptions.clear()

      requests.forEach(request => request.reject(error))
      subscriptions.forEach(subscription => subscription.isActive && subscription.onError?.(error))
    })

    // A failed connection rejects through whichever operation opened it.
    this.ready.catch(() => {})
  }

  /**
   * Also true while closing, since a server that started closing no longer handles requests.
   */
  get isClosed(): boolean {
    return this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED
  }

  publish(event: string, data: SerializedEvent): Promise<void> {
    return this.request({ type: 'publish', id: ++this.lastRequestId, event, data })
  }

  async subscribe(
    event: string,
    lastEventId: string | undefined,
    deliver: (data: SerializedEvent) => void,
    onError: ((error: ThrowableError) => void) | undefined,
  ): Promise<() => Promise<void>> {
    const id = ++this.lastRequestId
    const subscription: ClientSubscription = { isActive: false, deliver, onError }

    // Registered before the request so replayed events, which precede the ack, reach it.
    this.subscriptions.set(id, subscription)

    try {
      await this.request({ type: 'subscribe', id, event, lastEventId }, () => {
        // Activated synchronously on ack, since live events may follow in the same chunk.
        subscription.isActive = true

        let active = this.activeSubscriptions.get(event)
        if (!active) {
          this.activeSubscriptions.set(event, active = new Set())
        }

        active.add(subscription)
      })
    }
    catch (error) {
      this.subscriptions.delete(id)
      this.updateRef()
      throw error
    }

    return once(async () => {
      // Already gone if the connection closed.
      if (!this.subscriptions.delete(id)) {
        return
      }

      const active = this.activeSubscriptions.get(event)!
      active.delete(subscription)

      if (active.size === 0) {
        this.activeSubscriptions.delete(event)
      }

      this.send({ type: 'unsubscribe', id })
      this.updateRef()
    })
  }

  private request(message: Exclude<ClientMessage, { type: 'unsubscribe' }>, onAck?: () => void): Promise<void> {
    /* v8 ignore next 3 - the connection is open whenever a request starts, but we keep this check for safety. */
    if (this.isClosed) {
      return Promise.reject(new Error('Connection to the publisher server is closed'))
    }

    const { promise, resolve, reject } = promiseWithResolvers<void>()

    this.pendingRequests.set(message.id, {
      resolve: () => {
        onAck?.()
        resolve()
      },
      reject,
    })

    this.send(message)
    this.updateRef()

    return promise
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    let message: ServerMessage

    try {
      if (isBinary) {
        throw new TypeError('Binary messages are not supported')
      }

      message = JSON.parse(data.toString())
    }
    catch (error) {
      this.lastError = new Error('Received an invalid message from the publisher server', { cause: error })
      this.ws.close(1007, 'Invalid message')
      return
    }

    switch (message.type) {
      case 'event': {
        // Deleting from a Set while iterating it is safe, so a listener may unsubscribe others.
        this.activeSubscriptions.get(message.event)?.forEach(subscription => subscription.deliver(message.data))
        break
      }

      case 'replay': {
        this.subscriptions.get(message.id)?.deliver(message.data)
        break
      }

      case 'ack':
      case 'error': {
        const request = this.pendingRequests.get(message.id)

        if (request) {
          this.pendingRequests.delete(message.id)

          if (message.type === 'ack') {
            request.resolve()
          }
          else {
            request.reject(new Error(message.message))
          }

          this.updateRef()
        }

        break
      }
    }
  }

  private send(message: ClientMessage): void {
    this.ws.send(stringifyJSON(message))
  }

  /**
   * Keeps the process alive only while there is something to wait for,
   * so an idle connection never blocks the process from exiting.
   */
  private updateRef(): void {
    if (this.pendingRequests.size > 0 || this.subscriptions.size > 0) {
      this.socket?.ref()
    }
    else {
      this.socket?.unref()
    }
  }
}

export interface UnixSocketPublisherServerOptions {
  /**
   * Configuration for event resume support.
   *
   * When enabled, published events are temporarily stored so new
   * subscribers can resume from a previous position using `lastEventId`.
   *
   * @default { enabled: false }
   */
  resume?: {
    /**
     * Whether event resume support is enabled.
     *
     * When enabled, published events are temporarily stored so new
     * subscribers can resume from a previous position using `lastEventId`.
     *
     * @default false
     */
    enabled: boolean

    /**
     * How long (in seconds) to retain events for resume.
     *
     * Expired events are cleaned up lazily for performance reasons, so
     * some events may remain available slightly longer than this period.
     *
     * @default 300 (5 min)
     */
    seconds?: number
  }
}

interface StoredEvent {
  id: string
  expiresAt: number
  /**
   * The serialized event, with its id already attached.
   */
  data: string
}

interface ServerConnection {
  ws: WebSocket
  /**
   * Subscription id to event name.
   */
  subscriptions: Map<number, string>
}

/**
 * Server that `UnixSocketPublisher` instances connect to. Listens on a Unix domain socket
 * (or a Windows named pipe) and fans published events out to subscribers in every connected
 * process, with optional event storage for resume support.
 *
 * @remarks
 * **Note**: Anyone allowed to connect to the socket can publish and subscribe, so restrict access with file permissions.
 *
 * @see {@link https://orpc.dev/docs/helpers/publisher#adapters | Publisher Helpers - Adapters}
 */
export class UnixSocketPublisherServer {
  private readonly resumeEnabled: boolean
  private readonly resumeSeconds: number

  private readonly httpServer: Server
  private readonly wss: WebSocketServer
  private readonly connections = new Set<ServerConnection>()

  /**
   * Event name to the number of subscriptions each connection holds for it.
   */
  private readonly subscribers = new Map<string, Map<ServerConnection, number>>()
  private readonly eventsMap = new Map<string, StoredEvent[]>()

  /**
   * Starts at the current time in microseconds so new ids stay above every id issued
   * by a previous server instance, letting subscribers resume across server restarts.
   */
  private nextEventId = BigInt(Date.now()) * 1000n

  constructor({ resume }: UnixSocketPublisherServerOptions = {}) {
    this.resumeEnabled = resume?.enabled ?? false
    this.resumeSeconds = resume?.seconds ?? 300

    this.wss = new WebSocketServer({ noServer: true })

    this.httpServer = createServer((_request, response) => {
      response.writeHead(426, { connection: 'Upgrade', upgrade: 'websocket' }).end()
    })

    this.httpServer.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, ws => this.handleConnection(ws))
    })
  }

  /**
   * Starts listening on a Unix domain socket path or a Windows named pipe.
   *
   * @remarks
   * **Note**: A stale socket file left behind by a crashed server is replaced, while a socket still in use fails with `EADDRINUSE`.
   */
  async listen(path: string): Promise<void> {
    try {
      await listenServer(this.httpServer, path)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || !await isStaleSocket(path)) {
        throw error
      }

      await unlink(path)
      await listenServer(this.httpServer, path)
    }
  }

  /**
   * Stops accepting connections and closes the existing ones, which fails their subscriptions.
   */
  async close(): Promise<void> {
    const closed = new Promise<void>((resolve, reject) => {
      this.httpServer.close(error => error ? reject(error) : resolve())
    })

    for (const { ws } of this.connections) {
      ws.close(1001, 'Server closing')
    }

    await closed
  }

  private handleConnection(ws: WebSocket): void {
    const connection: ServerConnection = { ws, subscriptions: new Map() }
    this.connections.add(connection)

    ws.on('message', (data, isBinary) => {
      this.handleMessage(connection, data, isBinary)
    })

    ws.on('error', () => {
      // `close` always follows and cleans up.
    })

    ws.on('close', () => {
      this.connections.delete(connection)

      for (const id of connection.subscriptions.keys()) {
        this.unsubscribe(connection, id)
      }
    })
  }

  private handleMessage(connection: ServerConnection, data: RawData, isBinary: boolean): void {
    let message: unknown

    try {
      message = isBinary ? undefined : JSON.parse(data.toString())
    }
    catch {}

    if (!isPlainObject(message) || typeof message.id !== 'number') {
      connection.ws.close(1008, 'Invalid message')
      return
    }

    const id = message.id
    const { type, event, data: eventData, lastEventId } = message

    if (type === 'unsubscribe') {
      this.unsubscribe(connection, id)
      return
    }

    if (type === 'publish' && typeof event === 'string' && isSerializedEvent(eventData)) {
      this.publish(event, eventData)
      connection.ws.send(`{"type":"ack","id":${id}}`)
      return
    }

    if (
      type === 'subscribe'
      && typeof event === 'string'
      && (lastEventId === undefined || typeof lastEventId === 'string')
      && !connection.subscriptions.has(id)
    ) {
      this.subscribe(connection, id, event, lastEventId)
      return
    }

    connection.ws.send(stringifyJSON({ type: 'error', id, message: `Invalid ${String(type)} request` } satisfies ServerMessage))
  }

  private publish(event: string, data: Record<PropertyKey, unknown>): void {
    let serialized: string

    if (this.resumeEnabled) {
      this.cleanup()

      const id = (this.nextEventId++).toString(36)
      serialized = stringifyJSON({ ...data, meta: { ...data.meta as object | undefined, id } })

      let bucket = this.eventsMap.get(event)
      if (!bucket) {
        this.eventsMap.set(event, bucket = [])
      }

      bucket.push({ id, expiresAt: Date.now() + this.resumeSeconds * 1000, data: serialized })
    }
    else {
      serialized = stringifyJSON(data)
    }

    const subscribers = this.subscribers.get(event)

    if (subscribers) {
      // Built once, then sent to every subscribed connection.
      const message = `{"type":"event","event":${stringifyJSON(event)},"data":${serialized}}`

      for (const connection of subscribers.keys()) {
        connection.ws.send(message)
      }
    }
  }

  /**
   * Replays and registers within a single message handler, so no publish can slip in between.
   */
  private subscribe(connection: ServerConnection, id: number, event: string, lastEventId: string | undefined): void {
    if (this.resumeEnabled && lastEventId !== undefined) {
      this.cleanup()

      const bucket = this.eventsMap.get(event)

      if (bucket) {
        for (let i = findResumeStartIndex(bucket, lastEventId); i < bucket.length; i++) {
          connection.ws.send(`{"type":"replay","id":${id},"data":${bucket[i]!.data}}`)
        }
      }
    }

    connection.subscriptions.set(id, event)

    let subscribers = this.subscribers.get(event)
    if (!subscribers) {
      this.subscribers.set(event, subscribers = new Map())
    }

    subscribers.set(connection, (subscribers.get(connection) ?? 0) + 1)

    connection.ws.send(`{"type":"ack","id":${id}}`)
  }

  private unsubscribe(connection: ServerConnection, id: number): void {
    const event = connection.subscriptions.get(id)

    if (event === undefined) {
      return
    }

    connection.subscriptions.delete(id)

    const subscribers = this.subscribers.get(event)!
    const count = subscribers.get(connection)! - 1

    if (count > 0) {
      subscribers.set(connection, count)
      return
    }

    subscribers.delete(connection)

    if (subscribers.size === 0) {
      this.subscribers.delete(event)
    }
  }

  private lastCleanupTime: number = 0
  private cleanup(): void {
    const now = Date.now()

    // Throttle: only run cleanup at most once per retention window.
    if (now - this.lastCleanupTime < this.resumeSeconds * 1000) {
      return
    }

    this.lastCleanupTime = now

    for (const [event, bucket] of this.eventsMap) {
      bucket.splice(0, findFirstUnexpiredIndex(bucket, now))

      if (bucket.length === 0) {
        this.eventsMap.delete(event)
      }
    }
  }
}

function isSerializedEvent(value: unknown): value is Record<PropertyKey, unknown> {
  return isPlainObject(value) && (value.meta === undefined || isPlainObject(value.meta))
}

function listenServer(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function onError(error: Error) {
      server.off('listening', onListening)
      reject(error)
    }

    function onListening() {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(path)
  })
}

/**
 * Whether `path` is a socket file that nothing listens on anymore.
 */
async function isStaleSocket(path: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => undefined)

  if (!stats?.isSocket()) {
    return false
  }

  return new Promise((resolve) => {
    const socket = connect(path)

    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })

    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'ECONNREFUSED')
    })
  })
}

function findResumeStartIndex(bucket: StoredEvent[], lastEventId: string): number {
  let lo = 0
  let hi = bucket.length

  while (lo < hi) {
    const mid = (lo + hi) >>> 1

    if (compareSequentialIds(bucket[mid]!.id, lastEventId) > 0) {
      hi = mid
    }
    else {
      lo = mid + 1
    }
  }

  return lo
}

function findFirstUnexpiredIndex(bucket: StoredEvent[], now: number): number {
  let lo = 0
  let hi = bucket.length

  while (lo < hi) {
    const mid = (lo + hi) >>> 1

    if (bucket[mid]!.expiresAt <= now) {
      lo = mid + 1
    }
    else {
      hi = mid
    }
  }

  return lo
}
