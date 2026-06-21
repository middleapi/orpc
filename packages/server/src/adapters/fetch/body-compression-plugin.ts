import type { Context } from '../../context'
import type { FetchHandlerOptions } from './handler'
import type { FetchHandlerPlugin } from './plugin'
import { toArray } from '@orpc/shared'

const ORDERED_SUPPORTED_ENCODINGS = ['gzip', 'deflate'] as const

export interface BodyCompressionHandlerPluginOptions {
  /**
   * The compression schemes to use for response compression.
   * Schemes are prioritized by their order in this array and
   * only applied if the client supports them.
   *
   * @default ['gzip', 'deflate']
   */
  encodings?: readonly (typeof ORDERED_SUPPORTED_ENCODINGS)[number][]

  /**
   * The minimum response size in bytes required to trigger compression.
   * Responses smaller than this threshold will not be compressed to avoid overhead.
   * If the response size cannot be determined, compression will still be applied.
   *
   * @default 1024 (1KB)
   */
  threshold?: number

  /**
   * Override the default content-type filter used to determine which responses should be compressed.
   *
   * @warning Event stream responses are never compressed, regardless of this filter's return value.
   * @default only responses with compressible content types are compressed.
   */
  filter?: (request: Request, response: Response) => boolean
}

export class BodyCompressionHandlerPlugin<T extends Context> implements FetchHandlerPlugin<T> {
  name = '~body-compression'

  private readonly encodings: Exclude<BodyCompressionHandlerPluginOptions['encodings'], undefined>
  private readonly threshold: Exclude<BodyCompressionHandlerPluginOptions['threshold'], undefined>
  private readonly filter: Exclude<BodyCompressionHandlerPluginOptions['filter'], undefined>

  constructor(options: BodyCompressionHandlerPluginOptions = {}) {
    this.encodings = options.encodings ?? ORDERED_SUPPORTED_ENCODINGS
    this.threshold = options.threshold ?? 1024
    this.filter = (request, response) => {
      const hasContentDisposition = response.headers.has('content-disposition')
      const contentType = response.headers.get('content-type')

      if (!hasContentDisposition && contentType?.startsWith('text/event-stream')) {
        return false
      }

      return options.filter
        ? options.filter(request, response)
        : isCompressibleContentType(contentType)
    }
  }

  initFetchHandlerOptions(options: FetchHandlerOptions<T>): FetchHandlerOptions<T> {
    return {
      ...options,
      fetchInterceptors: [
        async (interceptorOptions) => {
          const result = await interceptorOptions.next()

          if (!result.matched) {
            return result
          }

          const response = result.response

          if (
            response.headers.has('content-encoding')
            || response.headers.has('transfer-encoding')
            || isNoTransformCacheControl(response.headers.get('cache-control'))
          ) {
            return result
          }

          const contentLength = response.headers.get('content-length')
          if (contentLength && Number(contentLength) < this.threshold) {
            return result
          }

          const acceptEncoding = interceptorOptions.request.headers
            .get('accept-encoding')
            ?.split(',')
            .map(enc => enc.trim().split(';')[0]!)

          const encoding = this.encodings.find(enc => acceptEncoding?.includes(enc))

          if (!response.body || encoding === undefined) {
            return result
          }

          if (!this.filter(interceptorOptions.request, response)) {
            return result
          }

          const compressedBody = response.body.pipeThrough(new CompressionStream(encoding))
          const compressedHeaders = new Headers(response.headers)

          compressedHeaders.delete('content-length')
          compressedHeaders.set('content-encoding', encoding)

          return {
            ...result,
            response: new Response(compressedBody, {
              status: response.status,
              statusText: response.statusText,
              headers: compressedHeaders,
            }),
          }
        },
        ...toArray(options.fetchInterceptors),
      ],
    }
  }
}

const COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i
function isCompressibleContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false
  }

  return COMPRESSIBLE_CONTENT_TYPE_REGEX.test(contentType)
}

const CACHE_CONTROL_NO_TRANSFORM_REGEX = /(?:^|,)\s*no-transform\s*(?:,|$)/i
function isNoTransformCacheControl(cacheControl: string | null): boolean {
  if (cacheControl === null) {
    return false
  }

  return CACHE_CONTROL_NO_TRANSFORM_REGEX.test(cacheControl)
}
