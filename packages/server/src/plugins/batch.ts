import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders, StandardRequest } from '@orpc/standard-server'
import type { BatchResponseBodyItem } from '@orpc/standard-server/batch'
import type { StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import { AsyncIteratorClass, isAsyncIteratorObject, isInSentryContext, runWithSpan, setSpanError, value } from '@orpc/shared'
import { flattenHeader } from '@orpc/standard-server'
import { parseBatchRequest, toBatchResponse } from '@orpc/standard-server/batch'

export interface BatchHandlerOptions<T extends Context> {
  /**
   * The max size of the batch allowed.
   *
   * @default 10
   */
  maxSize?: Value<Promisable<number>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * Map the request before processing it.
   *
   * @default merged back batch request headers into the request
   */
  mapRequestItem?(request: StandardRequest, batchOptions: StandardHandlerInterceptorOptions<T>): StandardRequest

  /**
   * Success batch response status code.
   *
   * @default 207
   */
  successStatus?: Value<Promisable<number>, [responses: Promise<BatchResponseBodyItem>[], batchOptions: StandardHandlerInterceptorOptions<T>]>

  /**
   * success batch response headers.
   *
   * @default {}
   */
  headers?: Value<Promisable<StandardHeaders>, [responses: Promise<BatchResponseBodyItem>[], batchOptions: StandardHandlerInterceptorOptions<T>]>
}

/**
 * The Batch Requests Plugin allows you to combine multiple requests and responses into a single batch,
 * reducing the overhead of sending each one separately.
 *
 * @see {@link https://orpc.unnoq.com/docs/plugins/batch-requests Batch Requests Plugin Docs}
 */
export class BatchHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly maxSize: Exclude<BatchHandlerOptions<T>['maxSize'], undefined>
  private readonly mapRequestItem: Exclude<BatchHandlerOptions<T>['mapRequestItem'], undefined>
  private readonly successStatus: Exclude<BatchHandlerOptions<T>['successStatus'], undefined>
  private readonly headers: Exclude<BatchHandlerOptions<T>['headers'], undefined>

  order = 5_000_000

  constructor(options: BatchHandlerOptions<T> = {}) {
    this.maxSize = options.maxSize ?? 10

    this.mapRequestItem = options.mapRequestItem ?? ((request, { request: batchRequest }) => ({
      ...request,
      headers: {
        ...batchRequest.headers,
        ...request.headers,
      },
    }))

    this.successStatus = options.successStatus ?? 207
    this.headers = options.headers ?? {}
  }

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    options.rootInterceptors.unshift(async (options) => {
      const xHeader = flattenHeader(options.request.headers['x-orpc-batch'])

      if (xHeader === undefined) {
        return options.next()
      }

      let isParsing = false

      try {
        return await runWithSpan({ name: 'handle_batch_request' }, async (span) => {
          if (isInSentryContext()) {
            span?.setAttribute('sentry.op', 'orpc')
          }
          const mode = xHeader === 'buffered' ? 'buffered' : 'streaming'

          isParsing = true
          const parsed = parseBatchRequest({ ...options.request, body: await options.request.body() })
          isParsing = false

          span?.setAttribute('batch.mode', mode)
          span?.setAttribute('batch.size', parsed.length)

          const maxSize = await value(this.maxSize, options)

          if (parsed.length > maxSize) {
            const message = 'Batch request size exceeds the maximum allowed size'
            setSpanError(span, message)

            return {
              matched: true,
              response: {
                status: 413,
                headers: {},
                body: message,
              },
            }
          }

          const responses: Promise<BatchResponseBodyItem>[] = parsed
            .map((request, index) => {
              const mapped = this.mapRequestItem(request, options)

              return options
                .next({ ...options, request: { ...mapped, body: () => Promise.resolve(mapped.body) } })
                .then(({ response, matched }) => {
                  span?.addEvent(`response.${index}.${matched ? 'success' : 'not_matched'}`)

                  if (matched) {
                    if (
                      response.body instanceof Blob
                      || response.body instanceof FormData
                      || isAsyncIteratorObject(response.body)
                    ) {
                      return {
                        index,
                        status: 500,
                        headers: {},
                        body: 'Batch responses do not support file/blob, or event-iterator. Please call this procedure separately outside of the batch request.',
                      }
                    }

                    return { ...response, index }
                  }

                  return { index, status: 404, headers: {}, body: 'No procedure matched' }
                })
                .catch((err) => {
                  /**
                   * send error into `unhandledRejection` handler
                   * so it can be logged or handled globally
                   */
                  Promise.reject(err)
                  return { index, status: 500, headers: {}, body: 'Internal server error' }
                })
            },
            )

          // wait until at least one request is resolved
          await Promise.race(responses)

          const status = await value(this.successStatus, responses, options)
          const headers = await value(this.headers, responses, options)
          const promises: (Promise<BatchResponseBodyItem> | undefined)[] = [...responses]

          const response = await toBatchResponse({
            status,
            headers,
            mode,
            body: new AsyncIteratorClass<BatchResponseBodyItem>(
              async () => {
                const handling = promises.filter(p => p !== undefined)

                if (handling.length <= 0) {
                  return { done: true, value: undefined }
                }

                const value = await Promise.race(handling)
                promises[value.index] = undefined
                return { done: false, value }
              },
              async () => {
                // do nothing on cleanup
              },
            ),
          })

          return {
            matched: true,
            response,
          }
        })
      }
      catch (cause) {
        if (isParsing) {
          return {
            matched: true,
            response: { status: 400, headers: {}, body: 'Invalid batch request, this could be caused by a malformed request body or a missing header' },
          }
        }

        throw cause
      }
    })
  }
}
