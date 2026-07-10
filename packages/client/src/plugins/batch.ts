import type { InterceptorOptions, Promisable, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyResponse, StandardRequest, StandardUrl } from '@standardserver/core'
import type { ClientPeerSendMessage } from '@standardserver/peer'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext } from '../types'
import { defer, isAsyncIteratorObject, loadBytes, splitInHalf, stringifyJSON, toArray, value } from '@orpc/shared'
import { parseStandardUrl } from '@standardserver/core'
import { ClientPeer, decodePeerMessage, isServerPeerSendMessage } from '@standardserver/peer'

export type BatchLinkPluginMode = 'streaming' | 'buffered'

export interface BatchLinkPluginGroup<T extends ClientContext> {
  /**
   * Determines whether a request should be included in this batch group.
   * Requests will be evaluated against each group's condition in order,
   * and included in the first group whose condition returns true.
   * If no group's condition returns true, the request will not be batched.
   */
  condition: Value<boolean, [options: StandardLinkTransportInterceptorOptions<T>]>

  /**
   * The client context applied to requests in this batch group for the remainder of the link chain.
   */
  context: Value<T, [items: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>

  /**
   * The path segments applied to requests in this batch group for the remainder of the link chain.
   *
   * @default []
   */
  path?: Value<string[], [items: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>
}

export class BatchLinkPluginError extends TypeError {}

export interface BatchLinkPluginOptions<T extends ClientContext> {
  groups: [BatchLinkPluginGroup<T>, ...BatchLinkPluginGroup<T>[]]

  /**
   * Filters requests to batch.
   *
   * @default () => true
   */
  filter?: Value<boolean, [options: StandardLinkTransportInterceptorOptions<T>]>

  /**
   * The maximum number of requests in the batch.
   *
   * @default 10
   */
  maxSize?: Value<Promisable<number>, [subOptionsList: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>

  /**
   * The batch response mode.
   *
   * @default 'streaming'
   */
  mode?: Value<BatchLinkPluginMode, [subOptionsList: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>

  /**
   * URL for the batch request.
   *
   * @default URL of the first subrequest in the batch + '/__batch__'
   */
  url?: Value<Promisable<StandardUrl>, [subOptionsList: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>

  /**
   * The maximum length of the URL that runtime supports,
   * if exceeded, the batch will be split into smaller batches and sent sequentially.
   *
   * This only applies to GET batch requests where the batch data is sent via URL query parameter.
   *
   * @default 2083
   */
  maxUrlLength?: Value<Promisable<number>, [subOptionsList: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>

  /**
   * Headers used for the batch request.
   *
   * @default Common headers among all subrequests in the batch.
   */
  headers?: Value<Promisable<StandardHeaders>, [subOptionsList: [StandardLinkTransportInterceptorOptions<T>, ...StandardLinkTransportInterceptorOptions<T>[]]]>

  /**
   * Map each subrequest in the batch before it is sent.
   *
   * @default Removes headers that are duplicated with the batch headers
   */
  mapSubrequest?: (subOptions: StandardLinkTransportInterceptorOptions<T>, partialBatchRequest: Pick<StandardRequest, 'url' | 'headers'>) => StandardRequest

  /**
   * Maps each subresponse before returning the final response.
   *
   * @default Low-priority merges headers from the batch response into each subresponse.
   */
  mapSubresponse?: (subResponse: StandardLazyResponse, batchResponse: StandardLazyResponse, subOptions: StandardLinkTransportInterceptorOptions<T>) => StandardLazyResponse
}

export class BatchLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~batch'

  private readonly groups: BatchLinkPluginOptions<T>['groups']
  private readonly filter: Exclude<BatchLinkPluginOptions<T>['filter'], undefined>
  private readonly maxSize: Exclude<BatchLinkPluginOptions<T>['maxSize'], undefined>
  private readonly mode: Exclude<BatchLinkPluginOptions<T>['mode'], undefined>
  private readonly batchUrl: Exclude<BatchLinkPluginOptions<T>['url'], undefined>
  private readonly maxUrlLength: Exclude<BatchLinkPluginOptions<T>['maxUrlLength'], undefined>
  private readonly batchHeaders: Exclude<BatchLinkPluginOptions<T>['headers'], undefined>
  private readonly mapSubrequest: Exclude<BatchLinkPluginOptions<T>['mapSubrequest'], undefined>
  private readonly mapSubresponse: Exclude<BatchLinkPluginOptions<T>['mapSubresponse'], undefined>

  private readonly queue: Map<
    BatchLinkPluginGroup<T>,
    [
        options: InterceptorOptions<StandardLinkTransportInterceptorOptions<T>, Promise<StandardLazyResponse>>,
        resolve: (response: StandardLazyResponse) => void,
        reject: (e: unknown) => void,
    ][]
  > = new Map()

  constructor(options: NoInfer<BatchLinkPluginOptions<T>>) {
    this.groups = options.groups
    this.filter = options.filter ?? (() => true)
    this.maxSize = options.maxSize ?? 10
    this.mode = options.mode ?? 'streaming'
    this.batchUrl = options.url ?? ((options) => {
      const [pathname] = parseStandardUrl(options[0].request.url)
      return `${pathname}/__batch__`
    })
    this.maxUrlLength = options.maxUrlLength ?? 2083
    this.batchHeaders = options.headers ?? (async (options) => {
      const headersList = options.map(o => o.request.headers)
      const commonHeaders: StandardHeaders = {}
      for (const headers of headersList) {
        for (const [key, value] of Object.entries(headers)) {
          if (headersList.every(h => h[key] === value)) {
            commonHeaders[key] = value
          }
        }
      }

      return commonHeaders
    })
    this.mapSubrequest = options.mapSubrequest ?? (({ request }, { headers }) => {
      const subHeaders = { ...request.headers }
      for (const [key, value] of Object.entries(headers)) {
        if (subHeaders[key] === value) {
          subHeaders[key] = undefined
        }
      }

      return {
        ...request,
        headers: subHeaders,
      }
    })
    this.mapSubresponse = (subResponse, batchResponse) => {
      return {
        ...subResponse,
        headers: {
          ...batchResponse.headers, // low-priority
          ...subResponse.headers,
        },
      }
    }
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async (interceptorOptions) => {
    /**
     * Only apply batching to requests with undefined or JSON-serializable bodies.
     * Other body types  are not suitable for batching.
     */
      if (
        interceptorOptions.request.body instanceof Blob
        || interceptorOptions.request.body instanceof ReadableStream
        || isAsyncIteratorObject(interceptorOptions.request.body)
        || interceptorOptions.request.signal?.aborted
        || !value(this.filter, interceptorOptions)
      ) {
        return interceptorOptions.next()
      }

      const group = this.groups.find(group => value(group.condition, interceptorOptions))

      if (!group) {
        return interceptorOptions.next()
      }

      return new Promise((resolve, reject) => {
        const queue = this.queue.get(group) ?? []
        if (!this.queue.has(group)) {
          this.queue.set(group, queue)
        }

        queue.push([interceptorOptions, resolve, reject])
        defer(() => this.processPendingBatches())
      })
    }

    return {
      ...options,
      transportInterceptors: [...toArray(options.transportInterceptors), transportInterceptor],
    }
  }

  private async processPendingBatches(): Promise<void> {
    const pending = new Map(this.queue)
    this.queue.clear()

    for (const [group, items] of pending) {
      const getItems = items.filter(([options]) => options.request.method === 'GET')
      const restItems = items.filter(([options]) => options.request.method !== 'GET')

      this.executeBatch('GET', group, getItems)
      this.executeBatch('POST', group, restItems)
    }
  }

  private async executeBatch(
    method: 'GET' | 'POST',
    group: BatchLinkPluginGroup<T>,
    groupItems: typeof this.queue extends Map<any, infer U> ? U : never,
  ): Promise<void> {
    if (!groupItems.length) {
      return
    }

    if (groupItems.length === 1) {
      const [options, resolve, reject] = groupItems[0]!
      options.next().then(resolve).catch(reject)
      return
    }

    const subOptionsList = groupItems.map(([options]) => options) as [
      InterceptorOptions<StandardLinkTransportInterceptorOptions<T>, Promise<StandardLazyResponse>>,
      ...InterceptorOptions<StandardLinkTransportInterceptorOptions<T>, Promise<StandardLazyResponse>>[],
    ]

    const maxSize = await value(this.maxSize, subOptionsList)
    if (groupItems.length > maxSize) {
      const [first, second] = splitInHalf(groupItems)

      await Promise.all([
        this.executeBatch(method, group, first),
        this.executeBatch(method, group, second),
      ])

      return
    }

    const url = await value(this.batchUrl, subOptionsList)
    const headers = await value(this.batchHeaders, subOptionsList)
    const mode = value(this.mode, subOptionsList)
    let suppressErrorFromCurrentBatch = false

    const controller = new AbortController()
    const pendingMessages: ClientPeerSendMessage[] = []
    let batchResponse: StandardLazyResponse

    const peer = new ClientPeer(async (message) => {
      pendingMessages.push(message)

      if (message.kind === 'cancel' && pendingMessages.filter(m => m.kind === 'cancel').length === groupItems.length) {
        controller.abort()
      }

      if (message.kind === 'request' && pendingMessages.filter(m => m.kind === 'request').length === groupItems.length) {
        // DON'T await this to avoid blocking the peer's message sending process.
        ;(async () => {
          try {
            const request: StandardRequest = {
              url,
              method,
              headers: { ...headers, 'orpc-batch': mode },
              signal: controller.signal,
            }

            if (method === 'GET') {
              const [pathname, search, hash] = parseStandardUrl(url)
              const dataParam = `data=${encodeURIComponent(stringifyJSON(pendingMessages))}`
              const newUrl: StandardUrl = search
                ? `${pathname}${search}&${dataParam}${hash ?? ''}`
                : `${pathname}?${dataParam}${hash ?? ''}`

              const maxUrlLength = await value(this.maxUrlLength, subOptionsList)
              if (newUrl.length > maxUrlLength) {
                const [first, second] = splitInHalf(groupItems)
                suppressErrorFromCurrentBatch = true

                await Promise.all([
                  this.executeBatch(method, group, first),
                  this.executeBatch(method, group, second),
                  peer.close(),
                ])

                return
              }

              request.url = newUrl
            }
            else {
              request.body = pendingMessages
            }

            batchResponse = await groupItems[0]![0]!.next({
              ...subOptionsList[0],
              context: value(group.context, subOptionsList) as T,
              path: value(group.path, subOptionsList) ?? [],
              request,
              signal: controller.signal,
            })

            const body = await batchResponse.resolveBody()

            if (Array.isArray(body) && body.every(v => isServerPeerSendMessage(v))) {
              for (const message of body) {
                await peer.message(message)
              }
            }
            else if (body instanceof Blob) {
              await decodeLengthPrefixedBlob(body, peer)
            }
            else if (body instanceof ReadableStream) {
              await decodeLengthPrefixedStream(body, peer)
            }
            else {
              throw new BatchLinkPluginError('Invalid batch response format.')
            }

            await peer.close(new BatchLinkPluginError('Batch response is incomplete.'))
          }
          catch (error) {
            await peer.close(error)
          }
        })()
      }
    })

    groupItems.forEach(([subOptions, resolve, reject]) => {
      peer
        .request(this.mapSubrequest(subOptions, { url, headers }))
        .then(subResponse => resolve(this.mapSubresponse(subResponse, batchResponse, subOptions)))
        .catch((error) => {
          if (!suppressErrorFromCurrentBatch) {
            reject(error)
          }
        })
    })
  }
}

async function decodeLengthPrefixedBlob(blob: Blob, peer: ClientPeer): Promise<void> {
  const buffer = await loadBytes(blob)
  let offset = 0

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) {
      throw new BatchLinkPluginError('Invalid batch response: incomplete length header.')
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4)
    const length = view.getUint32(0, false)
    offset += 4

    // Zero-length frame is a keep-alive ping; skip it.
    if (length === 0) {
      continue
    }

    if (offset + length > buffer.length) {
      throw new BatchLinkPluginError('Invalid batch response: incomplete message.')
    }

    const messageBytes = buffer.subarray(offset, offset + length)
    offset += length

    const result = decodePeerMessage(messageBytes)
    if (!result.matched || !isServerPeerSendMessage(result.message)) {
      throw new BatchLinkPluginError('Invalid batch response: invalid message.')
    }

    await peer.message(result.message)
  }
}

async function decodeLengthPrefixedStream(stream: ReadableStream<Uint8Array>, peer: ClientPeer): Promise<void> {
  const reader = stream.getReader()
  let buffer = new Uint8Array(0)

  try {
    while (true) {
      const { done, value: chunk } = await reader.read()

      if (chunk) {
        const newBuffer = new Uint8Array(buffer.length + chunk.length)
        newBuffer.set(buffer)
        newBuffer.set(chunk, buffer.length)
        buffer = newBuffer
      }

      while (buffer.length >= 4) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, 4)
        const length = view.getUint32(0, false)

        // Zero-length frame is a keep-alive ping; skip it.
        if (length === 0) {
          buffer = buffer.subarray(4)
          continue
        }

        if (buffer.length < 4 + length) {
          break
        }

        const messageBytes = buffer.subarray(4, 4 + length)
        buffer = buffer.subarray(4 + length)

        const result = decodePeerMessage(messageBytes)

        if (!result.matched || !isServerPeerSendMessage(result.message)) {
          throw new BatchLinkPluginError('Invalid batch response: invalid message.')
        }

        await peer.message(result.message)
      }

      if (done) {
        break
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}
