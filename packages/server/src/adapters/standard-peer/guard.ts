import type { Value } from '@orpc/shared'
import type { StandardBody, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { ClientPeerSendMessage, PeerEventStreamMessage, PeerOctetStreamMessage, PeerRequestMessage, ServerPeerSendMessage } from '@standard-server/peer'
import { COMMON_ERROR_STATUS_MAP, ORPCError, RPCSerializer } from '@orpc/client'
import { AsyncIteratorClass, isAsyncIteratorObject, once, value } from '@orpc/shared'
import { cancelStandardBody, flattenStandardHeader } from '@standard-server/core'
import { ServerPeer } from '@standard-server/peer'

/**
 * Estimated memory a buffered stream message takes beyond its encoded size
 * (decoded message objects, queue slot and accounting entry), so floods of empty messages stay bounded.
 */
const STREAM_MESSAGE_OVERHEAD = 128

/**
 * How often waiting sends re-check the buffered amount when no other drain signal is given.
 */
const SEND_POLL_INTERVAL = 20

const getTooManyRequestsBody = once(() => new RPCSerializer().serialize(new ORPCError('TOO_MANY_REQUESTS').toJSON()))

export interface StandardPeerGuardOptions {
  /**
   * Maximum number of requests one connection may have in flight at once.
   * A request stays in flight until its procedure and response stream finish,
   * so a long-lived subscription holds its slot until it ends.
   *
   * Requests above the limit are answered with a `TOO_MANY_REQUESTS` (429) error without running the procedure.
   * When the client does not read and as many rejections are waiting to be sent, further requests are dropped without an answer.
   *
   * Set to `Infinity` to disable the limit.
   *
   * @default 100
   */
  maxConcurrentRequests?: number | undefined

  /**
   * Maximum total size in bytes of streamed request input (`AsyncIteratorObject`, `ReadableStream`, ...)
   * that one connection may have sent but its procedures not yet read, across all its requests.
   *
   * The peer protocol has no inbound flow control, so when a message would exceed the limit,
   * the input of the request it belongs to is cancelled: the client is told to stop sending it,
   * and the procedure's next read throws a `PAYLOAD_TOO_LARGE` error.
   *
   * Set to `Infinity` to disable the limit.
   *
   * @default 16 * 1024 * 1024 (16 MiB)
   */
  maxBufferedStreamSize?: number | undefined

  /**
   * Maximum number of bytes queued on the connection but not yet transmitted before sending waits.
   * While a client does not read, streaming responses stop pulling from procedures, as over HTTP.
   *
   * Only applies when the transport has `getBufferedAmount`.
   * Set to `Infinity` to never wait.
   *
   * @default 1024 * 1024 (1 MiB)
   */
  sendHighWaterMark?: number | undefined
}

/**
 * How a {@link StandardPeerGuard} reaches its connection.
 */
export interface StandardPeerGuardTransport {
  /**
   * Encodes and sends a message from the peer. Pass the final send to `sendWhenDrained`,
   * which calls it once the connection is at or below `sendHighWaterMark`, or drops it once the connection is closed.
   */
  send: (message: ServerPeerSendMessage, sendWhenDrained: (send: () => unknown) => Promise<void>) => Promise<void>

  /**
   * Returns the bytes buffered on the connection but not yet transmitted,
   * `undefined` when unknown (sends right away), or `null` once closed. Throwing counts as closed.
   * Without it, sending never waits.
   */
  getBufferedAmount?: (() => number | null | undefined) | undefined

  /**
   * Waits for the buffered amount to drop to `threshold`, or the signal to abort.
   *
   * @default polls `getBufferedAmount`
   */
  waitForDrain?: ((threshold: number, signal: AbortSignal) => Promise<void>) | undefined
}

interface StreamBudget {
  size: number
  readonly limit: number
}

type StreamKind = 'event-stream' | 'octet-stream'

interface SendWaiter {
  send: () => unknown
  resolve: (result?: unknown) => void
  reject: (error: unknown) => void
}

/**
 * A `ServerPeer` for one connection that bounds the memory the connection can make the server hold:
 * in-flight requests, unread streamed input, and responses the client does not read.
 */
export class StandardPeerGuard {
  private readonly peer: ServerPeer
  private readonly getBufferedAmount: StandardPeerGuardTransport['getBufferedAmount']
  private readonly waitForDrain: (threshold: number, signal: AbortSignal) => Promise<void>
  private readonly maxConcurrentRequests: number
  private readonly sendHighWaterMark: number
  private readonly budget: StreamBudget
  private readonly streams = new Map<string, StreamInput>()
  private readonly waiters: SendWaiter[] = []
  private readonly controller = new AbortController()
  private activeRequests = 0
  private pendingRejections = 0
  private draining = false

  constructor(transport: StandardPeerGuardTransport, options: StandardPeerGuardOptions = {}) {
    this.peer = new ServerPeer(message => transport.send(message, this.sendWhenDrained))
    this.getBufferedAmount = transport.getBufferedAmount
    this.waitForDrain = transport.waitForDrain ?? poll
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 100
    this.sendHighWaterMark = options.sendHighWaterMark ?? 1024 * 1024
    this.budget = { size: 0, limit: options.maxBufferedStreamSize ?? 16 * 1024 * 1024 }
  }

  /**
   * Handles a client message, enforcing the limits.
   * `size` is the encoded size of the message in bytes, only read for stream messages.
   *
   * Everything before the peer handles the message runs synchronously, so message order is preserved.
   */
  message(
    message: ClientPeerSendMessage,
    handleRequest: (request: StandardLazyRequest) => Promise<StandardResponse>,
    size: Value<number>,
  ): Promise<void> {
    if (message.kind === 'request') {
      if (this.activeRequests < this.maxConcurrentRequests) {
        return this.handle(message, handleRequest)
      }

      // Rejections only pile up while their responses wait for the client to read.
      if (this.pendingRejections < this.maxConcurrentRequests || this.waiters.length === 0) {
        return this.reject(message)
      }

      // The client does not read its rejections either: create no state and send nothing.
      return Promise.resolve()
    }

    if ((message.kind === 'event-stream' || message.kind === 'octet-stream') && !this.admit(message, size)) {
      return Promise.resolve()
    }

    return this.peer.message(message, handleRequest)
  }

  /**
   * Ends waiting sends, releases all accounting, and closes the peer, which aborts all requests.
   */
  async close(): Promise<void> {
    this.controller.abort()

    for (const stream of this.streams.values()) {
      stream.release()
    }

    this.streams.clear()
    await this.peer.close()
  }

  private readonly sendWhenDrained = async (send: () => unknown): Promise<void> => {
    if (this.waiters.length === 0) {
      const state = this.checkSend()

      if (state === 'ready') {
        await send()
        return
      }

      if (state === 'closed') {
        return
      }
    }

    await new Promise((resolve, reject) => {
      this.waiters.push({ send, resolve, reject })
      void this.drain()
    })
  }

  private checkSend(): 'ready' | 'full' | 'closed' {
    if (this.sendHighWaterMark === Infinity) {
      return 'ready'
    }

    if (this.controller.signal.aborted) {
      return 'closed'
    }

    let bufferedAmount: number | null | undefined

    try {
      bufferedAmount = this.getBufferedAmount?.()
    }
    catch {
      return 'closed'
    }

    if (bufferedAmount === null) {
      return 'closed'
    }

    return bufferedAmount === undefined || bufferedAmount <= this.sendHighWaterMark ? 'ready' : 'full'
  }

  /**
   * Sends waiting messages in order as the connection drains, one loop per connection.
   * Each send happens in the same synchronous step as its check.
   */
  private async drain(): Promise<void> {
    if (this.draining) {
      return
    }

    this.draining = true

    try {
      while (this.waiters.length) {
        const state = this.checkSend()

        if (state === 'full') {
          await this.waitForDrain(this.sendHighWaterMark, this.controller.signal).catch(() => {})
          continue
        }

        const waiter = this.waiters.shift()!

        if (state === 'closed') {
          waiter.resolve()
          continue
        }

        try {
          waiter.resolve(waiter.send())
        }
        catch (error) {
          waiter.reject(error)
        }
      }
    }
    finally {
      this.draining = false
    }
  }

  private async handle(
    message: PeerRequestMessage,
    handleRequest: (request: StandardLazyRequest) => Promise<StandardResponse>,
  ): Promise<void> {
    this.activeRequests++
    let stream: StreamInput | undefined

    try {
      // The peer calls this synchronously for a new id, before any stream message for it can arrive.
      await this.peer.message(message, (request) => {
        stream = this.track(message, request)
        return handleRequest(stream ? { ...request, resolveBody: stream.resolveBody } : request)
      })
    }
    finally {
      this.activeRequests--

      if (stream) {
        stream.release()

        // A newer request may already reuse the id.
        if (this.streams.get(message.id) === stream) {
          this.streams.delete(message.id)
        }
      }
    }
  }

  /**
   * Answers through the peer, so it still ignores a duplicate id.
   */
  private async reject(message: PeerRequestMessage): Promise<void> {
    this.pendingRejections++

    try {
      await this.peer.message(message, async (request) => {
        if (getStreamKind(message)) {
          // Tell the client to stop sending streamed input right away.
          request.resolveBody().then(cancelStandardBody).catch(() => {})
        }

        return {
          status: COMMON_ERROR_STATUS_MAP.TOO_MANY_REQUESTS,
          headers: {},
          body: getTooManyRequestsBody(),
        }
      })
    }
    finally {
      this.pendingRejections--
    }
  }

  private track(message: PeerRequestMessage, request: StandardLazyRequest): StreamInput | undefined {
    const kind = getStreamKind(message)

    if (kind === undefined || this.budget.limit === Infinity) {
      return undefined
    }

    const stream = new StreamInput(kind, request.resolveBody, this.budget)
    this.streams.set(message.id, stream)
    return stream
  }

  private admit(message: PeerEventStreamMessage | PeerOctetStreamMessage, size: Value<number>): boolean {
    if (this.budget.limit === Infinity) {
      return true
    }

    const stream = this.streams.get(message.id)

    // Only pass on messages that are counted. The peer would drop any other one anyway.
    if (stream?.kind !== message.kind || stream.state !== 'open') {
      return false
    }

    const cost = value(size) + STREAM_MESSAGE_OVERHEAD

    if (this.budget.size + cost > this.budget.limit) {
      stream.overflow()
      return false
    }

    stream.push(cost)
    return true
  }
}

/**
 * Mirrors when the peer creates a queue for a request body.
 */
function getStreamKind(message: PeerRequestMessage): StreamKind | undefined {
  if (message.json.body !== undefined || message.binary !== undefined) {
    return undefined
  }

  if (message.json.headers?.['content-type'] !== undefined) {
    return 'octet-stream'
  }

  if (flattenStandardHeader(message.json.headers?.['standard-server']) === 'event-stream') {
    return 'event-stream'
  }

  return undefined
}

function poll(_threshold: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined

    function done() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', done)
      resolve()
    }

    timeout = setTimeout(done, SEND_POLL_INTERVAL)
    // Do not keep Node.js alive only for this.
    ;(timeout as unknown as { unref?: () => void }).unref?.()
    signal.addEventListener('abort', done)
  })
}

/**
 * Accounts the streamed input of one request: each received message adds its cost,
 * and each item the procedure reads removes the cost of the oldest message.
 * An item can stand for more than one message (the peer skips some), which only over-estimates.
 */
class StreamInput {
  state: 'open' | 'finished' | 'overflowed' = 'open'

  private size = 0
  private costs: number[] = []
  private head = 0
  private consumerResolved = false
  private upstream: Promise<StandardBody> | undefined
  private iterator: AsyncIterator<unknown> | undefined
  private reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined

  constructor(
    readonly kind: StreamKind,
    private readonly resolveUpstreamBody: StandardLazyRequest['resolveBody'],
    private readonly budget: StreamBudget,
  ) {}

  readonly resolveBody: StandardLazyRequest['resolveBody'] = async (...args) => {
    if (this.consumerResolved) {
      // Let the peer reject a repeated read.
      return this.resolveUpstreamBody(...args)
    }

    this.consumerResolved = true
    const body = await this.resolveUpstream()

    if (this.iterator) {
      return this.wrapIterator(this.iterator)
    }

    if (this.reader) {
      return this.wrapReader(this.reader)
    }

    this.release()
    return body
  }

  push(cost: number): void {
    this.costs.push(cost)
    this.size += cost
    this.budget.size += cost
  }

  /**
   * Releases what this input still has accounted. Later messages for it are dropped.
   */
  release(state: 'finished' | 'overflowed' = 'finished'): void {
    if (this.state !== 'open') {
      return
    }

    this.state = state
    this.budget.size -= this.size
    this.size = 0
    this.costs = []
    this.head = 0
  }

  /**
   * Cancels the input. The peer then discards its queue and sends `stream/cancel` to the client.
   */
  overflow(): void {
    this.release('overflowed')
    this.cancelUpstream()
  }

  private cancelUpstream(): void {
    const { iterator, reader } = this

    if (iterator) {
      (async () => iterator.return?.())().catch(() => {})
    }
    else if (reader) {
      reader.cancel().catch(() => {})
    }
    else {
      // Nobody has read the body yet (e.g. RPC `GET`): resolve it, then cancel it.
      this.resolveUpstream().catch(() => {})
    }
  }

  private resolveUpstream(): Promise<StandardBody> {
    return this.upstream ??= this.resolveUpstreamBody().then((body) => {
      if (isAsyncIteratorObject(body)) {
        this.iterator = body
      }
      else if (body instanceof ReadableStream) {
        this.reader = body.getReader()
      }

      if (this.state === 'overflowed' && (this.iterator || this.reader)) {
        this.cancelUpstream()
      }

      return body
    })
  }

  private consume(): void {
    if (this.state !== 'open') {
      return
    }

    const cost = this.costs[this.head] ?? 0
    this.head++
    this.size -= cost
    this.budget.size -= cost

    if (this.head >= 1024 && this.head * 2 >= this.costs.length) {
      this.costs.splice(0, this.head)
      this.head = 0
    }
  }

  /**
   * Reads one item, accounting it as read. Once overflowed, reads throw `PAYLOAD_TOO_LARGE`.
   */
  private async read<T extends { done?: boolean | undefined }>(next: () => Promise<T>): Promise<T> {
    this.throwIfOverflowed()
    let result: T

    try {
      result = await next()
    }
    catch (error) {
      this.throwIfOverflowed()
      this.release()
      throw error
    }

    this.throwIfOverflowed()

    if (result.done) {
      this.release()
    }
    else {
      this.consume()
    }

    return result
  }

  private throwIfOverflowed(): void {
    if (this.state === 'overflowed') {
      throw new ORPCError('PAYLOAD_TOO_LARGE')
    }
  }

  private wrapIterator(iterator: AsyncIterator<unknown>): AsyncIteratorClass<unknown> {
    return new AsyncIteratorClass(() => this.read(() => iterator.next()), async ({ kind }) => {
      this.release()

      if (kind === 'cancelled') {
        await iterator.return?.()
      }
    })
  }

  private wrapReader(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>): ReadableStream<Uint8Array<ArrayBuffer>> {
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      // A rejected pull errors the stream with the same reason.
      pull: async (controller) => {
        const result = await this.read(() => reader.read())

        if (result.done) {
          controller.close()
        }
        else {
          controller.enqueue(result.value)
        }
      },
      cancel: async (reason) => {
        this.release()
        await reader.cancel(reason)
      },
    }, {
      // Only pull when the procedure reads, so items are counted as read when they really are.
      highWaterMark: 0,
    })
  }
}
