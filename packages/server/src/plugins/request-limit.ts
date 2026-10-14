import type { StandardLazyRequest } from '@standard-server/core'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { ORPCError } from '@orpc/client'
import { toArray } from '@orpc/shared'
import { flattenStandardHeader } from '@standard-server/core'
import { toFetchHeaders, toStandardBody } from '@standard-server/fetch'

export interface RequestLimitHandlerPluginOptions {
  /**
   * The maximum allowed request body size in bytes.
   */
  maxBodySize: number
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
  after = ['~batch']

  /**
   * Should limit the final body size instead of the compressed one.
   */
  before = ['~request-compression']

  private readonly maxBodySize: number

  constructor(options: RequestLimitHandlerPluginOptions) {
    this.maxBodySize = options.maxBodySize
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const maxBodySize = this.maxBodySize

    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      return next({
        ...interceptorOptions,
        request: {
          ...interceptorOptions.request,
          resolveBody: toLimitedResolveBody(interceptorOptions.request, maxBodySize),
        },
      })
    }

    return {
      ...options,
      routingInterceptors: [
        routingInterceptor,
        ...toArray(options.routingInterceptors),
      ],
    }
  }
}

/**
 * A `resolveBody` for `request` that rejects with `PAYLOAD_TOO_LARGE` once the body exceeds `maxBodySize` bytes,
 * checking `content-length` up front and then counting the bytes actually read (so chunked bodies are limited too).
 * Called with the `'octet-stream'` hint, it resolves the limited stream itself.
 * Shared by the request limit plugin and `@orpc/nest` so they limit bodies the same way.
 */
export function toLimitedResolveBody(
  request: Pick<StandardLazyRequest, 'headers' | 'resolveBody'>,
  maxBodySize: number,
): StandardLazyRequest['resolveBody'] {
  // captured now so `request.resolveBody` can be replaced with the returned function
  const resolveBody = request.resolveBody.bind(request)

  return async (hint) => {
    const contentLength = Number(flattenStandardHeader(request.headers['content-length']))

    if (Number.isFinite(contentLength) && contentLength > maxBodySize) {
      throw new ORPCError('PAYLOAD_TOO_LARGE')
    }

    const stream = await resolveBody('octet-stream')

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
            controller.error(new ORPCError('PAYLOAD_TOO_LARGE'))
            return
          }

          controller.enqueue(chunk)
        },
      }),
    )

    const response = new Response(limitedStream, {
      headers: toFetchHeaders(request.headers),
    })

    return toStandardBody(response, { hint })
  }
}
