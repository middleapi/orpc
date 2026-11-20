import type { AnyORPCError } from '@orpc/client'
import { ORPCError } from '@orpc/client'
import type { Value } from '@orpc/shared'
import { toArray, value } from '@orpc/shared'
import { flattenStandardHeader } from '@standard-server/core'
import { toFetchHeaders, toStandardBody } from '@standard-server/fetch'

import type {
  StandardHandlerOptions,
  StandardHandlerPlugin,
  StandardHandlerRoutingInterceptor,
  StandardHandlerRoutingInterceptorOptions,
} from '../adapters/standard/index'
import type { Context } from '../context'

export interface RequestLimitHandlerPluginOptions<T extends Context = Context> {
  /**
   * The maximum allowed request body size in bytes.
   */
  maxBodySize: number

  /**
   * The error to throw when the body exceeds `maxBodySize`.
   *
   * @default ORPCError('PAYLOAD_TOO_LARGE')
   */
  error?: Value<AnyORPCError, [options: StandardHandlerRoutingInterceptorOptions<T>]> | undefined
}

/**
 * Rejects requests whose body exceeds `maxBodySize`.
 *
 * When used with the request compression plugin, the limit applies to the
 * decompressed payload rather than the compressed wire size.
 *
 * @see {@link https://orpc.dev/docs/plugins/request-limit | Request Limit Plugin}
 */
export class RequestLimitHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~request-limit'

  /**
   * Should limit the original batch request body instead of sub-requests.
   */
  after: string[] = ['~batch']

  /**
   * Should limit the final body size instead of the compressed one.
   */
  before: string[] = ['~request-compression']

  private readonly maxBodySize: number
  private readonly error: Exclude<RequestLimitHandlerPluginOptions<T>['error'], undefined>

  constructor(options: NoInfer<RequestLimitHandlerPluginOptions<T>>) {
    this.maxBodySize = options.maxBodySize
    this.error = options.error ?? (() => new ORPCError('PAYLOAD_TOO_LARGE'))
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const maxBodySize = this.maxBodySize
    const error = this.error

    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({
      next,
      ...interceptorOptions
    }) => {
      return next({
        ...interceptorOptions,
        request: {
          ...interceptorOptions.request,
          async resolveBody(hint) {
            const contentLength = Number(
              flattenStandardHeader(interceptorOptions.request.headers['content-length']),
            )

            if (Number.isFinite(contentLength) && contentLength > maxBodySize) {
              throw value(error, interceptorOptions)
            }

            const stream = await interceptorOptions.request.resolveBody('octet-stream')

            // adapter might not support hint (e.g. peer adapter)
            if (!(stream instanceof ReadableStream)) {
              return stream
            }

            let currentBodySize = 0
            const limitedStream = stream.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  currentBodySize += chunk.byteLength

                  if (currentBodySize > maxBodySize) {
                    controller.error(value(error, interceptorOptions))
                    return
                  }

                  controller.enqueue(chunk)
                },
              }),
            )

            const response = new Response(limitedStream, {
              headers: toFetchHeaders(interceptorOptions.request.headers),
            })

            return toStandardBody(response, { hint })
          },
        },
      })
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }
}
