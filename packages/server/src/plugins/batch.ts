import type { BatchLinkPluginMode } from '@orpc/client/plugins'
import type { Promisable, ThrowableError, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { ClientPeerSendMessage, ServerPeerSendMessage } from '@standard-server/peer'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '../adapters/standard'
import type { Context } from '../context'
import { ORPCError } from '@orpc/client'
import { promiseWithResolvers, stringifyJSON, toArray, value } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standard-server/core'
import { encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standard-server/peer'

/**
 * Content type for batch responses that use the length-prefixed binary framing
 * (streaming mode, and buffered mode when any sub-response contains binary).
 *
 * Decoding is driven by the `standard-server` body hint, not this header,
 * so it only serves to describe the payload to logs, proxies, and dev tools.
 */
export const BATCH_CONTENT_TYPE = 'application/vnd.orpc.batch'

const textEncoder = new TextEncoder()

export interface BatchHandlerPluginOptions<T extends Context> {
  /**
   * The max size of the batch allowed.
   *
   * @default 10
   */
  maxSize?: Value<Promisable<number>, [options: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Map each subrequest in the batch before it is processed.
   *
   * @default merges the batch request headers into the subrequest, giving them priority over
   * the subrequest headers, and removes the `orpc-batch` header to prevent nested batching
   */
  mapSubrequest?: (subrequest: StandardLazyRequest, batchOptions: StandardHandlerRoutingInterceptorOptions<T>) => StandardLazyRequest

  /**
   * Called when a subrequest throws instead of returning a response, for example when
   * `mapSubrequest` or a routing interceptor throws, or when the Rethrow Handler Plugin
   * rethrows an error. The subrequest still gets a 500 response, since the batch response
   * is shared with the other subrequests and cannot be failed for one of them.
   *
   * Errors thrown by this callback are ignored.
   */
  onError?: (error: ThrowableError, subrequest: StandardLazyRequest, batchOptions: StandardHandlerRoutingInterceptorOptions<T>) => Promisable<void>

  /**
   * Success batch response status code.
   *
   * @default 207
   */
  successStatus?: Value<Promisable<number>, [batchOptions: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Success batch response headers.
   *
   * @default {}
   */
  headers?: Value<Promisable<StandardHeaders>, [batchOptions: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * The max total size (in bytes) of streamed subresponses a buffered batch holds in memory.
   *
   * Buffered mode sends nothing until every subrequest finishes, so a subresponse that is an
   * event iterator or a `ReadableStream` is kept in memory until it ends. A stream that would
   * exceed this limit is cancelled, and its client call fails. Streaming mode is not limited,
   * since it only reads a subresponse as fast as the client reads the batch response.
   *
   * @default 10485760 (10MB)
   */
  maxBufferedStreamSize?: Value<Promisable<number>, [batchOptions: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Keep-alive settings for streaming batch responses.
   *
   * When enabled, a zero-length length-prefixed frame is sent periodically while the
   * stream is idle (no message sent for `interval` ms). Clients ignore these frames.
   * Only applies to streaming mode.
   *
   * @default { enabled: true, interval: 15000 }
   */
  keepAlive?: undefined | {
    /**
     * If true, a keep-alive frame is sent periodically while the stream is idle.
     *
     * @default true
     */
    enabled: boolean
    /**
     * Interval (in milliseconds) between keep-alive frames after the last message.
     *
     * @default 15000
     */
    interval?: number
  }
}

/**
 * Handles batch requests sent by the client Batch Link Plugin, splitting each
 * batch into sub-requests and streaming their responses back together.
 *
 * @remarks
 * **Note**: HTTP/2 and later already multiplex requests over a single connection, which often makes this plugin unnecessary.
 *
 * @see {@link https://orpc.dev/docs/plugins/batch | Batch Plugin}
 */
export class BatchHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~batch'

  /**
   * Run batch interceptors inside the tracing interceptors
   * so each subrequest gets its own span instead of sharing one batch-level span.
   */
  after = ['~tracing']

  private readonly maxSize: Exclude<BatchHandlerPluginOptions<T>['maxSize'], undefined>
  private readonly mapSubrequest: Exclude<BatchHandlerPluginOptions<T>['mapSubrequest'], undefined>
  private readonly onError: BatchHandlerPluginOptions<T>['onError']
  private readonly successStatus: Exclude<BatchHandlerPluginOptions<T>['successStatus'], undefined>
  private readonly headers: Exclude<BatchHandlerPluginOptions<T>['headers'], undefined>
  private readonly maxBufferedStreamSize: Exclude<BatchHandlerPluginOptions<T>['maxBufferedStreamSize'], undefined>
  private readonly keepAliveEnabled: boolean
  private readonly keepAliveInterval: number

  constructor(options: BatchHandlerPluginOptions<T> = {}) {
    this.maxSize = options.maxSize ?? 10

    this.mapSubrequest = options.mapSubrequest ?? ((subRequest, { request: batchRequest }) => ({
      ...subRequest,
      headers: {
        ...subRequest.headers,
        /**
         * The batch request headers win over the subrequest ones. They are the only ones the
         * transport actually saw, so headers the browser injects on its own, such as `cookie`
         * or `origin`, cannot be overridden by a subrequest, which is just request payload.
         */
        ...batchRequest.headers,
        'orpc-batch': undefined, // useful in case batch plugin is used multiple times
      },
    }))

    this.onError = options.onError
    this.successStatus = options.successStatus ?? 207
    this.headers = options.headers ?? {}
    this.maxBufferedStreamSize = options.maxBufferedStreamSize ?? 10 * 1024 * 1024
    this.keepAliveEnabled = options.keepAlive?.enabled ?? true
    this.keepAliveInterval = options.keepAlive?.interval ?? 15_000
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      const batchHeader = flattenStandardHeader(interceptorOptions.request.headers['orpc-batch'])

      if (batchHeader === undefined) {
        return interceptorOptions.next()
      }

      const mode: BatchLinkPluginMode = batchHeader === 'buffered' ? 'buffered' : 'streaming'

      let messages: ClientPeerSendMessage[]

      try {
        if (interceptorOptions.request.method === 'GET') {
          const [, search] = parseStandardUrl(interceptorOptions.request.url)
          const params = new URLSearchParams(search)
          const data = params.getAll('data').at(-1)

          if (!data) {
            return {
              matched: true,
              response: { status: 400, headers: {}, body: 'Missing data parameter for batch request' },
            }
          }

          const mightBeMessages = JSON.parse(data)

          if (!Array.isArray(mightBeMessages) || mightBeMessages.some(m => !isClientPeerSendMessage(m))) {
            return {
              matched: true,
              response: { status: 400, headers: {}, body: 'Invalid batch request data parameter' },
            }
          }

          messages = mightBeMessages
        }
        else {
          const mightBeMessages = await interceptorOptions.request.resolveBody()

          if (!Array.isArray(mightBeMessages) || mightBeMessages.some(m => !isClientPeerSendMessage(m))) {
            return {
              matched: true,
              response: { status: 400, headers: {}, body: 'Invalid batch request body' },
            }
          }

          messages = mightBeMessages
        }
      }
      catch (error) {
        return {
          matched: true,
          response: {
            status: 400,
            headers: {},
            body: error instanceof ORPCError ? error.message : 'Invalid batch request',
          },
        }
      }

      const outerMethod = interceptorOptions.request.method
      if (
        (outerMethod === 'GET' || outerMethod === 'QUERY')
        && messages.some(message => message.kind === 'request' && message.json.method !== outerMethod)
      ) {
        return {
          matched: true,
          response: { status: 400, headers: {}, body: `${outerMethod} batch requests only accept ${outerMethod} sub-requests` },
        }
      }

      const maxSize = await value(this.maxSize, interceptorOptions)

      if (messages.length > maxSize) {
        return {
          matched: true,
          response: { status: 413, headers: {}, body: 'Batch request size exceeds the maximum allowed size' },
        }
      }

      const handleIndividualRequest = async (subrequest: StandardLazyRequest): Promise<StandardResponse> => {
        try {
          const request = this.mapSubrequest(subrequest, interceptorOptions)
          const { matched, response } = await interceptorOptions.next({ ...interceptorOptions, request })

          if (!matched) {
            return { status: 404, headers: {}, body: 'No procedure matched' }
          }

          return response
        }
        catch (error) {
          /**
           * The error cannot propagate: the batch response is shared with the other subrequests,
           * and in streaming mode it has already been returned. Report it through `onError` instead
           * of leaving an unhandled rejection, which would terminate Node.js and Deno processes.
           */
          try {
            await this.onError?.(error as ThrowableError, subrequest, interceptorOptions)
          }
          catch {
            // Ignored, see `onError`
          }

          return { status: 500, headers: {}, body: 'Internal server error' }
        }
      }

      const signal = interceptorOptions.request.signal

      const runSubrequests = async (peer: ServerPeer): Promise<void> => {
        const promise = Promise.all(messages.map(msg => peer.message(msg, handleIndividualRequest)))
        const closePeer = () => peer.close(signal?.reason)

        if (signal?.aborted) {
          closePeer()
        }

        signal?.addEventListener('abort', closePeer)

        try {
          await promise
        }
        finally {
          signal?.removeEventListener('abort', closePeer)
        }
      }

      const status = await value(this.successStatus, interceptorOptions)
      const headers = await value(this.headers, interceptorOptions)

      if (mode === 'buffered') {
        const maxBufferedStreamSize = await value(this.maxBufferedStreamSize, interceptorOptions)
        let bufferedStreamSize = 0

        const responseMessages: ServerPeerSendMessage[] = []
        const peer = new ServerPeer(async (message) => {
          if (message.kind === 'event-stream' || message.kind === 'octet-stream') {
            const size = bufferedStreamSize + getStreamMessageSize(message)

            if (size > maxBufferedStreamSize) {
              /**
               * Throwing makes the peer cancel the stream and send a `cancel` message for the
               * subrequest, so an endless subresponse cannot grow the buffer without bound.
               */
              throw new Error('Buffered batch response exceeds the maximum allowed stream size')
            }

            bufferedStreamSize = size
          }

          responseMessages.push(message)
        })

        await runSubrequests(peer)
        await peer.close()

        if (responseMessages.some(msg => msg.binary !== undefined)) {
          const chunks: Uint8Array<ArrayBuffer>[] = []

          for (const message of responseMessages) {
            const bytes = await encodeBatchMessage(message)
            chunks.push(encodeLengthPrefix(bytes.byteLength), bytes)
          }

          return {
            matched: true,
            response: {
              status,
              headers,
              body: new Blob(chunks, { type: BATCH_CONTENT_TYPE }),
            },
          }
        }

        return {
          matched: true,
          response: { status, headers, body: responseMessages },
        }
      }

      // streaming mode — binary length-prefixed ReadableStream
      let streamController: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>
      let isStreamDone = false
      let lastSentAt = Date.now()
      let keepAliveTimer: ReturnType<typeof setTimeout> | undefined
      let pulled: ReturnType<typeof promiseWithResolvers<void>> | undefined

      const releaseSenders = () => {
        pulled?.resolve()
        pulled = undefined
      }

      /**
       * A single timer instead of one per message: when it fires, it only sends
       * a keep-alive frame if nothing was sent during the last interval.
       */
      const scheduleKeepAlive = (delay: number) => {
        keepAliveTimer = setTimeout(() => {
          const idle = Date.now() - lastSentAt

          if (idle < this.keepAliveInterval) {
            scheduleKeepAlive(this.keepAliveInterval - idle)
            return
          }

          /**
           * Skip the frame while earlier data is still queued: the connection is not idle,
           * and frames must not pile up behind a response the client does not read.
           */
          if (streamController.desiredSize! > 0) {
            try {
              // Zero-length length-prefixed frame = keep-alive (ignored by clients)
              streamController.enqueue(encodeLengthPrefix(0))
              lastSentAt = Date.now()
            }
            catch {
              return // Stream may already be closed or errored.
            }
          }

          scheduleKeepAlive(this.keepAliveInterval)
        }, delay)
      }

      /**
       * Stops the keep-alive and releases waiting senders once nobody reads the stream anymore:
       * when it is cancelled, when the batch request is aborted, or when every subrequest settled.
       */
      const finish = () => {
        isStreamDone = true
        clearTimeout(keepAliveTimer)
        releaseSenders()
        signal?.removeEventListener('abort', finish)
      }

      const shouldWaitForConsumer = () => !isStreamDone && streamController.desiredSize! <= 0

      const peer = new ServerPeer(async (message) => {
        const bytes = await encodeBatchMessage(message)

        /**
         * Backpressure: wait until the consumer reads what is already queued, so a subresponse
         * (e.g. an endless stream) is only read as fast as the client reads the batch response.
         * No `await` between this check and the enqueue, so concurrent senders cannot overshoot.
         */
        while (shouldWaitForConsumer()) {
          pulled ??= promiseWithResolvers()
          await pulled.promise
        }

        streamController.enqueue(encodeLengthPrefix(bytes.byteLength))
        streamController.enqueue(bytes)
        lastSentAt = Date.now()
      })

      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          streamController = controller
        },
        pull() {
          releaseSenders()
        },
        async cancel(reason) {
          finish()
          await peer.close(reason)
        },
      })

      if (this.keepAliveEnabled) {
        scheduleKeepAlive(this.keepAliveInterval)
      }

      if (signal?.aborted) {
        finish()
      }
      else {
        signal?.addEventListener('abort', finish)
      }

      // DO NOT await here to block streaming response
      runSubrequests(peer)
        .then(async () => {
          finish()
          streamController.close()
          await peer.close()
        })
        .catch(async (error) => {
          finish()
          streamController.error(error)
          await peer.close(error)
        })

      return {
        matched: true,
        response: {
          status,
          headers: { ...headers, 'content-type': BATCH_CONTENT_TYPE },
          body: stream,
        },
      }
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }
}

async function encodeBatchMessage(message: ServerPeerSendMessage): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = await encodePeerMessage(message)
  return typeof encoded === 'string' ? textEncoder.encode(encoded) : encoded
}

function encodeLengthPrefix(length: number): Uint8Array<ArrayBuffer> {
  const prefix = new Uint8Array(4)
  new DataView(prefix.buffer).setUint32(0, length, false)
  return prefix
}

function getStreamMessageSize(message: Extract<ServerPeerSendMessage, { kind: 'event-stream' | 'octet-stream' }>): number {
  if (message.binary !== undefined) {
    return message.binary instanceof Blob ? message.binary.size : message.binary.byteLength
  }

  return stringifyJSON(message.json).length
}
