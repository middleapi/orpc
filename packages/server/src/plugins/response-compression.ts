import type { StandardBodyHint } from '@standardserver/core'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { isAsyncIteratorObject, isCompressibleContentType, stringifyJSON, toArray } from '@orpc/shared'
import { flattenStandardHeader, generateContentDisposition } from '@standardserver/core'

// Rough UTF-8 estimate. Mostly ASCII text stays close to 1 byte/char;
// occasional multi-byte characters increase the average.
const AVG_BYTES_PER_CHAR = 1.2

export interface ResponseCompressionHandlerPluginOptions<_T extends Context> {
  /**
   * The compression schemes to use for response compression.
   * Schemes are prioritized by their order in this array and
   * only applied if the client supports them (via Accept-Encoding).
   *
   * @default ['gzip', 'deflate']
   */
  encodings?: readonly ('gzip' | 'deflate' | 'deflate-raw')[]

  /**
   * The minimum response size in bytes required to trigger compression.
   * Responses smaller than this threshold will not be compressed to avoid overhead.
   * If the response size cannot be determined, compression will still be applied.
   *
   * @default 1024 (1KB)
   */
  threshold?: number
}

/**
 * Compresses response bodies based on the client's Accept-Encoding header.
 * Works at the standard handler level, so it supports all adapters.
 *
 * @see {@link https://orpc.dev/docs/plugins/response-compression Response Compression Plugin Docs}
 */
export class ResponseCompressionHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~response-compression'

  /**
   * Compression should be done after batching, to compress the final response.
   * Compression should also be done after response headers are set, to access final headers like Content-Type and Cache-Control.
   */
  after = ['~batch', '~response-headers']

  private readonly encodings: Exclude<ResponseCompressionHandlerPluginOptions<T>['encodings'], undefined>
  private readonly threshold: Exclude<ResponseCompressionHandlerPluginOptions<T>['threshold'], undefined>

  constructor(options: ResponseCompressionHandlerPluginOptions<T> = {}) {
    this.encodings = options.encodings ?? ['gzip', 'deflate']
    this.threshold = options.threshold ?? 1024
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const result = await next()

      if (!result.matched) {
        return result
      }

      const response = result.response

      const contentEncoding = flattenStandardHeader(response.headers['content-encoding'])?.trim()?.toLowerCase()
      if (contentEncoding !== undefined) { // already compressed, do not compress again
        return result
      }

      // Cache-Control: no-transform forbids intermediaries (and this plugin) from transforming the body
      if (isNoTransformCacheControl(flattenStandardHeader(response.headers['cache-control']))) {
        return result
      }

      const acceptEncodings = parseAcceptEncodings(
        flattenStandardHeader(interceptorOptions.request.headers['accept-encoding']),
      )
      const encoding = this.encodings.find(enc => acceptEncodings.includes(enc))

      if (encoding === undefined) {
        return result
      }

      const body = response.body
      const headers = response.headers

      if (body instanceof ReadableStream) {
        const contentLength = Number(flattenStandardHeader(headers['content-length']))

        if (
          (!Number.isFinite(contentLength) || contentLength >= this.threshold)
          && isCompressibleContentType(flattenStandardHeader(headers['content-type']))
        ) {
          return {
            ...result,
            response: {
              ...response,
              body: body.pipeThrough(new CompressionStream(encoding)),
              headers: {
                ...headers,
                'standard-server': 'octet-stream' satisfies StandardBodyHint,
                'content-length': [],
                'content-encoding': encoding,
              },
            },
          }
        }
      }

      else if (body instanceof Blob) {
        if (
          (!Number.isFinite(body.size) || body.size >= this.threshold)
          && isCompressibleContentType(body.type)
        ) {
          const contentDisposition = headers['content-disposition'] ?? generateContentDisposition(
            body instanceof File ? body.name : 'blob',
          )

          return {
            ...result,
            response: {
              ...response,
              body: body.stream().pipeThrough(new CompressionStream(encoding)),
              headers: {
                ...headers,
                'standard-server': 'file' satisfies StandardBodyHint,
                'content-type': body.type,
                'content-length': [],
                'content-disposition': contentDisposition,
                'content-encoding': encoding,
              },
            },
          }
        }
      }

      else if (body instanceof FormData) {
        const PART_OVERHEAD = 64 // approx bytes for boundary + Content-Disposition/Content-Type headers per part

        let contentLength = 0
        for (const [key, value] of body) {
          contentLength += PART_OVERHEAD + key.length

          if (value instanceof Blob) {
            if (!Number.isFinite(value.size)) { // Bun-s3 can use NaN for size
              if (!isCompressibleContentType(value.type)) {
                // Unknown non-compressible part size makes the estimate unreliable
                contentLength = -Infinity
                break
              }

              // Unknown size for compressible content - still apply compression
              contentLength = Infinity
            }
            else {
              contentLength += isCompressibleContentType(value.type)
                ? value.size
                : -value.size
            }
          }
          else {
            contentLength += value.length * AVG_BYTES_PER_CHAR
          }
        }

        if (contentLength >= this.threshold) {
          const res = new Response(body)
          const compressedStream = res.body!.pipeThrough(new CompressionStream(encoding))

          return {
            ...result,
            response: {
              ...response,
              body: compressedStream,
              headers: {
                ...headers,
                'standard-server': [],
                'content-type': res.headers.get('content-type')!,
                'content-length': [],
                'content-encoding': encoding,
              },
            },
          }
        }
      }

      else if (body instanceof URLSearchParams) {
        const string = body.toString()
        if (string.length * AVG_BYTES_PER_CHAR >= this.threshold) {
          return {
            ...result,
            response: {
              ...response,
              body: new Blob([string]).stream().pipeThrough(new CompressionStream(encoding)),
              headers: {
                ...headers,
                'standard-server': [],
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': [],
                'content-encoding': encoding,
              },
            },
          }
        }
      }

      else if (body !== undefined && !isAsyncIteratorObject(body)) {
        const string = stringifyJSON(body)
        if (string.length * AVG_BYTES_PER_CHAR >= this.threshold) {
          return {
            ...result,
            response: {
              ...response,
              body: new Blob([string]).stream().pipeThrough(new CompressionStream(encoding)),
              headers: {
                ...headers,
                'standard-server': [],
                'content-type': 'application/json',
                'content-length': [],
                'content-encoding': encoding,
              },
            },
          }
        }
      }

      return result
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
 * Parse Accept-Encoding into coding tokens (q-values ignored; order is client preference).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-accept-encoding
 */
function parseAcceptEncodings(header: string | undefined): string[] {
  if (header === undefined) {
    return []
  }

  return header
    .split(',')
    .map(part => part.trim().split(';')[0]!.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Whether Cache-Control includes the no-transform directive.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform
 */
const CACHE_CONTROL_NO_TRANSFORM_REGEX = /(?:^|,)\s*no-transform\s*(?:,|$)/i
function isNoTransformCacheControl(cacheControl: string | undefined): boolean {
  if (cacheControl === undefined) {
    return false
  }

  return CACHE_CONTROL_NO_TRANSFORM_REGEX.test(cacheControl)
}
