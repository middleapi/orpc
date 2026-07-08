import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { toArray } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'
import { toFetchHeaders, toStandardBody } from '@standardserver/fetch'

const SUPPORTED_ENCODINGS = ['gzip', 'deflate', 'deflate-raw'] as const

export class RequestCompressionHandlerPlugin<T extends Context> implements StandardHandlerPlugin <T> {
  name = '~request-compression'

  after = ['~batch']

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const encoding = flattenStandardHeader(
        interceptorOptions.request.headers['content-encoding'],
      )?.trim()?.toLowerCase() as typeof SUPPORTED_ENCODINGS[number] | undefined

      if (encoding === undefined || !SUPPORTED_ENCODINGS.includes(encoding)) {
        return next()
      }

      const decompressedHeaders = {
        ...interceptorOptions.request.headers,
        'content-encoding': undefined,
      }

      return next({
        ...interceptorOptions,
        request: {
          ...interceptorOptions.request,
          headers: decompressedHeaders,
          async resolveBody(hint) {
            const stream = await interceptorOptions.request.resolveBody('octet-stream')

            // adapter might not support hint (e.g peer adapter)
            if (!(stream instanceof ReadableStream)) {
              return stream
            }

            const decompressedStream = stream.pipeThrough(new DecompressionStream(encoding))

            const response = new Response(decompressedStream, {
              headers: toFetchHeaders(decompressedHeaders),
            })

            return toStandardBody(response, { hint })
          },
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
