import type { CompressionEncoding } from '@orpc/shared'
import {
  estimateUtf8ByteLength,
  estimateCompressibleFormDataSize,
  isAsyncIteratorObject,
  isCompressibleContentType,
  toArray,
} from '@orpc/shared'
import type { StandardBodyHint, StandardHeaders } from '@standard-server/core'
import { flattenStandardHeader, generateContentDisposition } from '@standard-server/core'
import { toFetchBody } from '@standard-server/fetch'

import type {
  StandardLinkOptions,
  StandardLinkPlugin,
  StandardLinkTransportInterceptor,
  StandardLinkTransportInterceptorOptions,
} from '../adapters/standard/index'
import type { ClientContext } from '../types'

export interface RequestCompressionLinkPluginOptions<T extends ClientContext> {
  /**
   * The compression scheme to use for request compression.
   *
   * @default 'gzip'
   */
  encoding?: CompressionEncoding | undefined

  /**
   * The minimum request size in bytes required to trigger compression.
   * Requests smaller than this threshold will not be compressed to avoid overhead.
   * If the request size cannot be determined, compression will still be applied.
   *
   * @default 1024 (1KB)
   */
  threshold?: number | undefined

  /**
   * Determines whether a request with the given Content-Type should be compressed.
   * Only consulted for binary transfers (streams, files, and file form-data parts).
   * Also receives the transport interceptor options for per-request decisions.
   *
   * @default isCompressibleContentType (covers common text-based formats)
   */
  isCompressibleContentType?:
    | ((
        contentType: string | null | undefined,
        options: StandardLinkTransportInterceptorOptions<T>,
      ) => boolean)
    | undefined
}

/**
 * Compresses request bodies before sending them to the server,
 * reducing bandwidth usage for large payloads.
 *
 * @see {@link https://orpc.dev/docs/plugins/request-compression | Request Compression Plugin}
 */
export class RequestCompressionLinkPlugin<
  T extends ClientContext,
> implements StandardLinkPlugin<T> {
  name = '~request-compression'

  /**
   * Compression should be done after batching, to compress the final request
   */
  after: string[] = ['~batch']

  private readonly encoding: Exclude<RequestCompressionLinkPluginOptions<T>['encoding'], undefined>
  private readonly threshold: Exclude<
    RequestCompressionLinkPluginOptions<T>['threshold'],
    undefined
  >
  private readonly isCompressibleContentType: Exclude<
    RequestCompressionLinkPluginOptions<T>['isCompressibleContentType'],
    undefined
  >

  constructor(options: RequestCompressionLinkPluginOptions<T> = {}) {
    this.encoding = options.encoding ?? 'gzip'
    this.threshold = options.threshold ?? 1024
    this.isCompressibleContentType = options.isCompressibleContentType ?? isCompressibleContentType
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({
      next,
      ...interceptorOptions
    }) => {
      const request = interceptorOptions.request

      const contentEncoding = flattenStandardHeader(request.headers['content-encoding'])
        ?.trim()
        ?.toLowerCase()
      if (contentEncoding !== undefined) {
        // already compressed, do not compress again
        return next()
      }

      if (request.body instanceof ReadableStream) {
        const contentLength = Number(flattenStandardHeader(request.headers['content-length']))

        if (
          (!Number.isFinite(contentLength) || contentLength >= this.threshold) &&
          this.isCompressibleContentType(
            flattenStandardHeader(request.headers['content-type']),
            interceptorOptions,
          )
        ) {
          const compressedStream = request.body.pipeThrough(new CompressionStream(this.encoding))

          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...request.headers,
                'content-length': [],
                'content-encoding': this.encoding,
              },
            },
          })
        }
      } else if (request.body instanceof Blob) {
        const contentType = request.headers['content-type'] ?? request.body.type

        if (
          (!Number.isFinite(request.body.size) || request.body.size >= this.threshold) &&
          this.isCompressibleContentType(flattenStandardHeader(contentType), interceptorOptions)
        ) {
          const compressedStream = request.body
            .stream()
            .pipeThrough(new CompressionStream(this.encoding))
          const contentDisposition =
            request.headers['content-disposition'] ??
            generateContentDisposition(request.body instanceof File ? request.body.name : 'blob')

          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...request.headers,
                'standard-server':
                  request.headers['standard-server'] ?? ('file' satisfies StandardBodyHint),
                'content-type': contentType,
                'content-length': [],
                'content-disposition': contentDisposition,
                'content-encoding': this.encoding,
              },
            },
          })
        }
      } else if (request.body instanceof FormData) {
        const contentLength = estimateCompressibleFormDataSize(request.body, (contentType) =>
          this.isCompressibleContentType(contentType, interceptorOptions),
        )

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
      } else if (request.body instanceof URLSearchParams) {
        const string = request.body.toString()
        if (estimateUtf8ByteLength(string) >= this.threshold) {
          const compressedStream = new Blob([string])
            .stream()
            .pipeThrough(new CompressionStream(this.encoding))
          const [, bodyHeaders] = toFetchBody(request.body, request.headers)

          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...bodyHeaders,
                // An empty hint rather than none, so the adapter does not hint the compressed stream as `octet-stream`
                'standard-server': bodyHeaders['standard-server'] ?? [],
                'content-length': [],
                'content-encoding': this.encoding,
              },
            },
          })
        }
      } else if (request.body !== undefined && !isAsyncIteratorObject(request.body)) {
        const [string, bodyHeaders] = toFetchBody(request.body, request.headers) as [
          string,
          StandardHeaders,
        ]
        if (estimateUtf8ByteLength(string) >= this.threshold) {
          const compressedStream = new Blob([string])
            .stream()
            .pipeThrough(new CompressionStream(this.encoding))
          return next({
            ...interceptorOptions,
            request: {
              ...interceptorOptions.request,
              body: compressedStream,
              headers: {
                ...bodyHeaders,
                'standard-server': bodyHeaders['standard-server'] ?? [],
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
      transportInterceptors: [...toArray(options.transportInterceptors), transportInterceptor],
    }
  }
}
