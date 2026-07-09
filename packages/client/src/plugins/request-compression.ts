import type { StandardBodyHint } from '@standardserver/core'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor } from '../adapters/standard'
import type { ClientContext } from '../types'
import { isAsyncIteratorObject, isCompressibleContentType, stringifyJSON, toArray } from '@orpc/shared'
import { flattenStandardHeader, generateContentDisposition } from '@standardserver/core'

// Rough UTF-8 estimate. Mostly ASCII text stays close to 1 byte/char;
// occasional multi-byte characters increase the average.
const AVG_BYTES_PER_CHAR = 1.2

export interface RequestCompressionLinkPluginOptions<_T extends ClientContext> {
  /**
   * The compression scheme to use for request compression.
   *
   * @default 'gzip'
   */
  encoding?: 'gzip' | 'deflate' | 'deflate-raw'

  /**
   * The minimum request size in bytes required to trigger compression.
   * Requests smaller than this threshold will not be compressed to avoid overhead.
   * If the request size cannot be determined, compression will still be applied.
   *
   * @default 1024 (1KB)
   */
  threshold?: number
}

export class RequestCompressionLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~request-compression'

  /**
   * Compression should be done after batching, to compress the final request
   */
  after = ['~batch']

  private readonly encoding: Exclude<RequestCompressionLinkPluginOptions<T>['encoding'], undefined>
  private readonly threshold: Exclude<RequestCompressionLinkPluginOptions<T>['threshold'], undefined>

  constructor(options: RequestCompressionLinkPluginOptions<T> = {}) {
    this.encoding = options.encoding ?? 'gzip'
    this.threshold = options.threshold ?? 1024
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const request = interceptorOptions.request

      const contentEncoding = flattenStandardHeader(request.headers['content-encoding'])?.trim()?.toLowerCase()
      if (contentEncoding !== undefined) { // already compressed, do not compress again
        return next()
      }

      if (request.body instanceof ReadableStream) {
        const contentLength = Number(flattenStandardHeader(request.headers['content-length']))

        if (
          !Number.isNaN(contentLength)
          && contentLength >= this.threshold
          && isCompressibleContentType(flattenStandardHeader(request.headers['content-type']))
        ) {
          const compressedStream = request.body.pipeThrough(new CompressionStream(this.encoding))

          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...request.headers,
                'standard-server': 'octet-stream' satisfies StandardBodyHint,
                'content-length': [],
                'content-encoding': this.encoding,
              },
            },
          })
        }
      }

      else if (request.body instanceof Blob) {
        if (
          !Number.isNaN(request.body.size) // Bun-s3 can use NaN for size
          && request.body.size >= this.threshold
          && isCompressibleContentType(request.body.type)
        ) {
          const compressedStream = request.body.stream().pipeThrough(new CompressionStream(this.encoding))
          const contentDisposition = request.headers['content-disposition'] ?? generateContentDisposition(
            request.body instanceof File ? request.body.name : 'blob',
          )

          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...request.headers,
                'standard-server': 'file' satisfies StandardBodyHint,
                'content-type': request.body.type,
                'content-length': [],
                'content-disposition': contentDisposition,
                'content-encoding': this.encoding,
              },
            },
          })
        }
      }

      else if (request.body instanceof FormData) {
        const PART_OVERHEAD = 64 // approx bytes for boundary + Content-Disposition/Content-Type headers per part

        let contentLength = 0
        for (const [key, value] of request.body) {
          contentLength += PART_OVERHEAD + key.length

          if (value instanceof Blob) {
            if (Number.isNaN(value.size)) { // Bun-s3 can use NaN for size
              if (!isCompressibleContentType(value.type)) {
                break
              }
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

          if (contentLength >= this.threshold) {
            const res = new Response(request.body)
            const compressedStream = res.body!.pipeThrough(new CompressionStream(this.encoding))

            return next({
              ...interceptorOptions,
              request: {
                ...interceptorOptions.request,
                body: compressedStream,
                headers: {
                  ...request.headers,
                  'standard-server': [],
                  'content-type': res.headers.get('content-type')!,
                  'content-length': [],
                  'content-encoding': this.encoding,
                },
              },
            })
          }
        }
      }

      else if (request.body instanceof URLSearchParams) {
        const string = request.body.toString()
        if (string.length * AVG_BYTES_PER_CHAR >= this.threshold) {
          const compressedStream = new Blob([string]).stream().pipeThrough(new CompressionStream(this.encoding))
          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...request.headers,
                'standard-server': [],
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': [],
                'content-encoding': this.encoding,
              },
            },
          })
        }
      }

      else if (request.body !== undefined && !isAsyncIteratorObject(request.body)) {
        const string = stringifyJSON(request.body)
        if (string.length * AVG_BYTES_PER_CHAR >= this.threshold) {
          const compressedStream = new Blob([string]).stream().pipeThrough(new CompressionStream(this.encoding))
          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...request.headers,
                'standard-server': [],
                'content-type': 'application/json',
                'content-length': [],
                'content-encoding': this.encoding,
              },
            },
          })
        }
      }

      return next()
    }

    return {
      ...options,
      transportInterceptors: [
        ...toArray(options.transportInterceptors),
        transportInterceptor,
      ],
    }
  }
}
