import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { toArray } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'
import { toFetchHeaders, toStandardBody } from '@standardserver/fetch'

export class RequestCompressionHandlerPlugin<T extends Context> implements StandardHandlerPlugin <T> {
  name = '~request-compression'

  /**
   * Should decompress the original batch request body instead of sub-requests.
   */
  after = ['~batch']

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const encodings = parseContentEncodings(
        flattenStandardHeader(interceptorOptions.request.headers['content-encoding']),
      )

      if (encodings.length === 0 || !encodings.every(isSupportedEncoding)) {
        return next()
      }

      const decompressedHeaders = {
        ...interceptorOptions.request.headers,
        'content-length': undefined,
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

            let decompressedStream = stream
            for (let i = encodings.length - 1; i >= 0; i--) {
              decompressedStream = decompressedStream.pipeThrough(
                new DecompressionStream(encodings[i]!),
              )
            }

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

const SUPPORTED_ENCODINGS = ['gzip', 'deflate', 'deflate-raw'] as const
type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number]
function isSupportedEncoding(encoding: string): encoding is SupportedEncoding {
  return (SUPPORTED_ENCODINGS as readonly string[]).includes(encoding)
}

/**
 * Parse Content-Encoding into ordered codings (order applied).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-content-encoding
 */
function parseContentEncodings(header: string | undefined): string[] {
  if (header === undefined) {
    return []
  }

  return header
    .split(',')
    .map(part => part.trim().toLowerCase())
}
