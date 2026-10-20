import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { ClientPeerSendMessage, ServerPeerSendMessage } from '@standard-server/peer'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '../adapters/standard'
import type { Context } from '../context'
import { ORPCError } from '@orpc/client'
import { isAsyncIteratorObject, promiseWithResolvers, toArray, value } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standard-server/core'
import { encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standard-server/peer'

/**
 * Content type for batch responses that use the length-prefixed binary framing,
 * which they do when any sub-response contains binary or is a stream.
 *
 * Decoding is driven by the `standard-server` body hint, not this header,
 * so it only serves to describe the payload to logs, proxies, and dev tools.
 */
export const BATCH_CONTENT_TYPE = 'application/vnd.orpc.batch'

const textEncoder = new TextEncoder()

function encodeLengthPrefix(length: number): Uint8Array<ArrayBuffer> {
  const prefix = new Uint8Array(4)
  new DataView(prefix.buffer).setUint32(0, length, false)
  return prefix
}

/**
 * Encodes a message as a length-prefixed frame: its 4-byte big-endian length, then its bytes.
 */
async function encodeFrame(message: ServerPeerSendMessage): Promise<Uint8Array<ArrayBuffer>[]> {
  const encoded = await encodePeerMessage(message)
  const bytes = typeof encoded === 'string' ? textEncoder.encode(encoded) : encoded

  return [encodeLengthPrefix(bytes.byteLength), bytes]
}

/**
 * Whether a header describes a subresponse's own body, which the batch response does not share.
 */
function isBodyHeader(name: string): boolean {
  return name.startsWith('content-') || name === 'standard-server'
}

/**
 * Errors should not occur at the routing interceptor level.
 * Reject the promise so it can be handled by the unhandledRejection handler
 * for global logging or error handling.
 */
function internalError(err: unknown): StandardResponse {
  Promise.reject(err)

  return { status: 500, headers: {}, body: 'Internal server error' }
}

/**
 * What the batch needs from a subresponse before it answers, without keeping its body alive.
 */
interface SubresponseHead {
  headers: StandardHeaders
  stream: boolean
}

/**
 * Builds the batch response headers: the headers the subresponses all have with the same value, as
 * the client does with the headers every subrequest shares, then the batch headers, which win, and
 * the distinct cookies and `vary` fields of both. A cache must vary on whatever any subresponse varies on.
 */
function liftSubresponseHeaders(
  batchHeaders: StandardHeaders,
  subresponseHeaders: StandardHeaders[],
): StandardHeaders {
  const [first = {}, ...rest] = subresponseHeaders
  const shared: StandardHeaders = {}

  for (const [name, value] of Object.entries(first)) {
    if (value === undefined || isBodyHeader(name)) {
      continue
    }

    const flattened = flattenStandardHeader(value)

    if (rest.every(other => flattenStandardHeader(other[name]) === flattened)) {
      shared[name] = value
    }
  }

  const headers: StandardHeaders = { ...shared, ...batchHeaders }
  const cookies = new Set([batchHeaders, ...subresponseHeaders].flatMap(other => toArray(other['set-cookie'])))

  if (cookies.size > 0) {
    headers['set-cookie'] = [...cookies]
  }

  const varies = new Map<string, string>()

  for (const value of [batchHeaders, ...subresponseHeaders].flatMap(other => toArray(other.vary))) {
    for (const field of value.split(',')) {
      const name = field.trim()
      const key = name.toLowerCase()

      if (name && !varies.has(key)) {
        varies.set(key, name)
      }
    }
  }

  if (varies.size > 0) {
    headers.vary = varies.has('*') ? '*' : [...varies.values()].join(', ')
  }

  return headers
}

export interface BatchHandlerPluginOptions<T extends Context> {
  /**
   * The max size of the batch allowed.
   *
   * @default 10
   */
  maxSize?: Value<Promisable<number>, [options: StandardHandlerRoutingInterceptorOptions<T>]> | undefined

  /**
   * Map each subrequest in the batch before it is processed.
   *
   * @default merges the batch request headers into the subrequest, giving them priority over
   * the subrequest headers, and removes the `orpc-batch` header to prevent nested batching
   */
  mapSubrequest?: ((subrequest: StandardLazyRequest, batchOptions: StandardHandlerRoutingInterceptorOptions<T>) => StandardLazyRequest) | undefined

  /**
   * Map each sub-response in the batch before it is sent.
   *
   * @default removes the headers the batch response already has with the same value, which the client
   * merges back, and `set-cookie`, which the browser ignores there and JavaScript could read
   */
  mapSubresponse?: ((
    subresponse: StandardResponse,
    partialBatchResponse: Pick<StandardResponse, 'status' | 'headers'>,
    batchOptions: StandardHandlerRoutingInterceptorOptions<T>,
  ) => StandardResponse) | undefined

  /**
   * Success batch response status code.
   *
   * @default 207
   */
  successStatus?: Value<Promisable<number>, [batchOptions: StandardHandlerRoutingInterceptorOptions<T>]> | undefined

  /**
   * Success batch response headers.
   *
   * The batch response also gets the cookies its sub-responses set, and the headers they all share.
   * Headers set here win, and setting one to `undefined` keeps it off, except `set-cookie` and `vary`, which merge.
   *
   * @default {}
   */
  headers?: Value<Promisable<StandardHeaders>, [batchOptions: StandardHandlerRoutingInterceptorOptions<T>]> | undefined

  /**
   * Keep-alive settings for batch responses that stream.
   *
   * When enabled, a zero-length length-prefixed frame is sent periodically while the
   * stream is idle (no message sent for `interval` ms). Clients ignore these frames.
   *
   * @default { enabled: true, interval: 15000 }
   */
  keepAlive?: {
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
    interval?: number | undefined
  } | undefined
}

/**
 * Handles batch requests sent by the client Batch Link Plugin, splitting each
 * batch into sub-requests and sending their responses back together.
 *
 * @remarks
 * The batch starts the response once every sub-response is ready, so it carries the cookies sub-requests
 * set and the headers every sub-response shares. It streams when a sub-response is a stream.
 *
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
  private readonly mapSubresponse: Exclude<BatchHandlerPluginOptions<T>['mapSubresponse'], undefined>
  private readonly successStatus: Exclude<BatchHandlerPluginOptions<T>['successStatus'], undefined>
  private readonly headers: Exclude<BatchHandlerPluginOptions<T>['headers'], undefined>
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

    this.mapSubresponse = options.mapSubresponse ?? ((subresponse, { headers: batchHeaders }) => {
      const headers: StandardHeaders = {}

      for (const [name, value] of Object.entries(subresponse.headers)) {
        if (name !== 'set-cookie' && flattenStandardHeader(value) !== flattenStandardHeader(batchHeaders[name])) {
          headers[name] = value
        }
      }

      return { ...subresponse, headers }
    })

    this.successStatus = options.successStatus ?? 207
    this.headers = options.headers ?? {}
    this.keepAliveEnabled = options.keepAlive?.enabled ?? true
    this.keepAliveInterval = options.keepAlive?.interval ?? 15_000
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      if (flattenStandardHeader(interceptorOptions.request.headers['orpc-batch']) === undefined) {
        return interceptorOptions.next()
      }

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

      const status = await value(this.successStatus, interceptorOptions)
      const headers = await value(this.headers, interceptorOptions)

      // Messages the peer sends before the response streams, or the whole body when it does not
      const bufferedMessages: ServerPeerSendMessage[] = []
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
      let keepAliveTimer: ReturnType<typeof setInterval> | undefined

      // Every subresponse waits here until all of them are ready, so the batch response carries their headers
      const ready = messages.map(() => promiseWithResolvers<SubresponseHead | undefined>())
      const lifting = Promise.all(ready.map(({ promise }) => promise)).then((all) => {
        const heads = all.filter(head => head !== undefined)

        return {
          batchHeaders: liftSubresponseHeaders(headers, heads.map(head => head.headers)),
          streams: heads.some(head => head.stream),
        }
      })

      const clearKeepAlive = () => {
        if (keepAliveTimer !== undefined) {
          clearInterval(keepAliveTimer)
          keepAliveTimer = undefined
        }
      }

      const scheduleKeepAlive = () => {
        if (!this.keepAliveEnabled) {
          return
        }

        clearKeepAlive()
        keepAliveTimer = setInterval(() => {
          try {
            // Zero-length length-prefixed frame = keep-alive (ignored by clients)
            streamController!.enqueue(encodeLengthPrefix(0))
          }
          catch {
            // Stream may already be closed or errored.
            clearKeepAlive()
          }
        }, this.keepAliveInterval)
      }

      const enqueueMessage = async (message: ServerPeerSendMessage): Promise<void> => {
        for (const chunk of await encodeFrame(message)) {
          streamController!.enqueue(chunk)
        }
        scheduleKeepAlive() // reset idle timer
      }

      const peer = new ServerPeer(async (message) => {
        if (streamController === undefined) {
          bufferedMessages.push(message)
        }
        else {
          await enqueueMessage(message)
        }
      })

      const handleIndividualRequest = async (
        request: StandardLazyRequest,
        markReady: (head: SubresponseHead) => void,
      ): Promise<StandardResponse> => {
        let response: StandardResponse

        try {
          request = this.mapSubrequest(request, interceptorOptions)
          const result = await interceptorOptions.next({ ...interceptorOptions, request })
          response = result.matched ? result.response : { status: 404, headers: {}, body: 'No procedure matched' }
        }
        catch (err) {
          response = internalError(err)
        }

        markReady({
          headers: response.headers,
          stream: response.body instanceof ReadableStream || isAsyncIteratorObject(response.body),
        })
        const { batchHeaders } = await lifting

        try {
          return this.mapSubresponse(response, { status, headers: batchHeaders }, interceptorOptions)
        }
        catch (err) {
          return internalError(err)
        }
      }

      const runSubrequests = async (): Promise<void> => {
        const promise = Promise.all(messages.map((msg, i) => {
          const { resolve } = ready[i]!

          // Not every message reaches the handler, such as a cancel or a repeated id
          return peer.message(msg, request => handleIndividualRequest(request, resolve)).finally(() => resolve(undefined))
        }))
        const signal = interceptorOptions.request.signal
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

      const subrequests = runSubrequests()
      const { batchHeaders, streams } = await lifting

      if (!streams) {
        await subrequests
        await peer.close()

        if (bufferedMessages.some(msg => msg.binary !== undefined)) {
          const chunks = (await Promise.all(bufferedMessages.map(encodeFrame))).flat()

          return {
            matched: true,
            response: {
              status,
              headers: batchHeaders,
              body: new Blob(chunks, { type: BATCH_CONTENT_TYPE }),
            },
          }
        }

        return {
          matched: true,
          response: { status, headers: batchHeaders, body: bufferedMessages },
        }
      }

      /**
       * A stream is meant to be read as it arrives and might never end, so the batch answers with
       * the length-prefixed stream that every message is written to, starting with those buffered so far.
       */
      const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          streamController = controller
          scheduleKeepAlive()
        },
        async cancel(reason) {
          clearKeepAlive()
          await peer.close(reason)
        },
      })
      const flushed = Promise.all(bufferedMessages.splice(0).map(enqueueMessage))

      // DO NOT await here to block streaming response
      Promise.all([flushed, subrequests])
        .then(async () => {
          clearKeepAlive()
          streamController!.close()
          await peer.close()
        })
        .catch(async (error) => {
          clearKeepAlive()
          streamController!.error(error)
          await peer.close(error)
        })

      return {
        matched: true,
        response: {
          status,
          headers: { ...batchHeaders, 'content-type': BATCH_CONTENT_TYPE },
          body,
        },
      }
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }
}
