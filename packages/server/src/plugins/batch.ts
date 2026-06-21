import type { BatchLinkPluginMode } from '@orpc/client/plugins'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standardserver/core'
import type { ClientPeerSendMessage, ServerPeerSendMessage } from '@standardserver/peer'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '../adapters/standard'
import type { Context } from '../context'
import { toArray, value } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standardserver/core'
import { encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standardserver/peer'

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
   * @default merges the batch request headers into the subrequest and remove `orpc-batch` header to prevent nested batching
   */
  mapSubrequest?: (subrequest: StandardLazyRequest, batchOptions: StandardHandlerRoutingInterceptorOptions<T>) => StandardLazyRequest

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
}

export class BatchHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~batch'

  /**
   * Run batch interceptors before OpenTelemetry interceptors
   * so each subrequest gets its own span instead of sharing one batch-level span.
   */
  after = ['~opentelemetry']

  private readonly maxSize: Exclude<BatchHandlerPluginOptions<T>['maxSize'], undefined>
  private readonly mapSubrequest: Exclude<BatchHandlerPluginOptions<T>['mapSubrequest'], undefined>
  private readonly successStatus: Exclude<BatchHandlerPluginOptions<T>['successStatus'], undefined>
  private readonly headers: Exclude<BatchHandlerPluginOptions<T>['headers'], undefined>

  constructor(options: BatchHandlerPluginOptions<T> = {}) {
    this.maxSize = options.maxSize ?? 10

    this.mapSubrequest = options.mapSubrequest ?? ((subRequest, { request: batchRequest }) => ({
      ...subRequest,
      headers: {
        ...batchRequest.headers,
        ...subRequest.headers,
        'orpc-batch': undefined, // useful in case batch plugin is used multiple times
      },
    }))

    this.successStatus = options.successStatus ?? 207
    this.headers = options.headers ?? {}
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

          if (!Array.isArray(mightBeMessages)) {
            return {
              matched: true,
              response: { status: 400, headers: {}, body: 'Invalid batch request body' },
            }
          }

          messages = mightBeMessages
        }
      }
      catch {
        return {
          matched: true,
          response: { status: 400, headers: {}, body: 'Invalid batch request' },
        }
      }

      const maxSize = await value(this.maxSize, interceptorOptions)

      if (messages.length > maxSize) {
        return {
          matched: true,
          response: { status: 413, headers: {}, body: 'Batch request size exceeds the maximum allowed size' },
        }
      }

      const handleIndividualRequest = async (request: StandardLazyRequest): Promise<StandardResponse> => {
        try {
          request = this.mapSubrequest(request, interceptorOptions)
          const { matched, response } = await interceptorOptions.next({ ...interceptorOptions, request })

          if (!matched) {
            return { status: 404, headers: {}, body: 'No procedure matched' }
          }

          return response
        }
        catch (err) {
          /**
           * Errors should not occur at the routing interceptor level.
           * Reject the promise so it can be handled by the unhandledRejection handler
           * for global logging or error handling.
           */
          Promise.reject(err)

          return { status: 500, headers: {}, body: 'Internal server error' }
        }
      }

      const status = await value(this.successStatus, interceptorOptions)
      const headers = await value(this.headers, interceptorOptions)

      if (mode === 'buffered') {
        const responseMessages: ServerPeerSendMessage[] = []
        const peer = new ServerPeer(async (message) => {
          responseMessages.push(message)
        })

        await Promise.all(messages.map(msg => peer.message(msg, handleIndividualRequest)))
        await peer.close()

        if (responseMessages.some(msg => msg.binary !== undefined)) {
          const chunks: Uint8Array<ArrayBuffer>[] = []

          for (const message of responseMessages) {
            const encoded = await encodePeerMessage(message)
            const bytes = typeof encoded === 'string'
              ? new TextEncoder().encode(encoded)
              : encoded

            const lengthBuffer = new ArrayBuffer(4)
            new DataView(lengthBuffer).setUint32(0, bytes.byteLength, false)
            chunks.push(new Uint8Array(lengthBuffer))
            chunks.push(bytes)
          }

          return {
            matched: true,
            response: {
              status,
              headers,
              body: new Blob(chunks, { type: 'application/octet-stream' }),
            },
          }
        }

        return {
          matched: true,
          response: { status, headers, body: responseMessages },
        }
      }

      // streaming mode — binary length-prefixed ReadableStream
      let streamController: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          streamController = controller
        },
      })

      const peer = new ServerPeer(async (message) => {
        const encoded = await encodePeerMessage(message)
        const bytes = typeof encoded === 'string' ? new TextEncoder().encode(encoded) : encoded

        const lengthBuffer = new ArrayBuffer(4)
        new DataView(lengthBuffer).setUint32(0, bytes.byteLength, false)
        streamController.enqueue(new Uint8Array(lengthBuffer))
        streamController.enqueue(bytes)
      })

      // DO NOT await here to block streaming response
      Promise.all(messages.map(msg => peer.message(msg, handleIndividualRequest)))
        .then(async () => {
          streamController.close()
          await peer.close()
        })
        .catch(async (error) => {
          streamController.error(error)
          await peer.close(error)
        })

      return {
        matched: true,
        response: { status, headers, body: stream },
      }
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }
}
