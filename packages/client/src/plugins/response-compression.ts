import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor } from '../adapters/standard'
import type { ClientContext } from '../types'
import { toArray } from '@orpc/shared'
import { flattenStandardHeader } from '@standard-server/core'
import { toFetchHeaders, toStandardBody } from '@standard-server/fetch'

/**
 * Each coding adds a decompressor to the chain, so an unbounded list lets a tiny
 * response cost unbounded CPU and memory. Same limit as undici and curl.
 */
const MAX_CONTENT_ENCODINGS = 5

export interface ResponseCompressionLinkPluginOptions<_T extends ClientContext> {
  /**
   * Compression schemes to advertise via Accept-Encoding, in preference order.
   * Only schemes that can be decompressed by this plugin should be listed.
   *
   * @default ['gzip', 'deflate']
   */
  encodings?: readonly ('gzip' | 'deflate' | 'deflate-raw')[]
}

/**
 * Advertises Accept-Encoding on requests and decompresses response bodies
 * based on the Content-Encoding header. Works at the standard link level,
 * so it supports all adapters.
 *
 * A body the transport has already decoded, as fetch implementations do,
 * is passed through untouched.
 *
 * @see {@link https://orpc.dev/docs/plugins/response-compression | Response Compression Plugin}
 */
export class ResponseCompressionLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~response-compression'

  /**
   * Decompression should wrap the final batch response instead of sub-responses.
   */
  after = ['~batch']

  private readonly encodings: Exclude<ResponseCompressionLinkPluginOptions<T>['encodings'], undefined>

  constructor(options: ResponseCompressionLinkPluginOptions<T> = {}) {
    this.encodings = options.encodings ?? ['gzip', 'deflate']
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const acceptEncodingHeader = this.encodings.join(', ')

    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const response = await next({
        ...interceptorOptions,
        request: {
          ...interceptorOptions.request,
          headers: {
            ...interceptorOptions.request.headers,
            'accept-encoding': acceptEncodingHeader,
          },
        },
      })

      const encodings = parseContentEncodings(
        flattenStandardHeader(response.headers['content-encoding']),
      )

      if (encodings.length === 0 || !encodings.every(isSupportedEncoding)) {
        return response
      }

      const decompressedHeaders = {
        ...response.headers,
        'content-length': undefined,
        'content-encoding': undefined,
      }

      return {
        ...response,
        headers: decompressedHeaders,
        async resolveBody(hint) {
          const stream = await response.resolveBody('octet-stream')

          // adapter might not support hint (e.g. peer adapter)
          if (!(stream instanceof ReadableStream)) {
            return stream
          }

          if (encodings.length > MAX_CONTENT_ENCODINGS) {
            throw new TypeError('Too many content encodings.')
          }

          const fetchResponse = new Response(decompressIfEncoded(stream, encodings), {
            headers: toFetchHeaders(decompressedHeaders),
          })

          return toStandardBody(fetchResponse, { hint })
        },
      }
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

const SIGNATURE_LENGTHS: Record<SupportedEncoding, number> = {
  'gzip': 3,
  'deflate': 2,
  'deflate-raw': 1,
}

/**
 * Fetch implementations decode the codings they support (gzip and deflate included) but keep the
 * Content-Encoding header, and they decode either every listed coding or none of them. So the body is
 * only decompressed when it starts with the signature of the last applied coding, and passed through
 * otherwise. deflate-raw has no signature, but it is not an HTTP content coding, so fetch never decodes it.
 *
 * The signature is read on the first pull, so resolving a streamed body does not wait for its first bytes.
 *
 * @see https://fetch.spec.whatwg.org/#handle-content-codings
 */
function decompressIfEncoded(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  encodings: readonly SupportedEncoding[],
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const lastEncoding = encodings[encodings.length - 1]!
  const reader = stream.getReader()
  let output: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined

  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      if (output === undefined) {
        const prefix = await readPrefix(reader, SIGNATURE_LENGTHS[lastEncoding])
        reader.releaseLock()

        // put the bytes read back in front of the rest of the body
        let body = stream.pipeThrough(new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
          start(prefixController) {
            if (prefix.length > 0) {
              prefixController.enqueue(prefix)
            }
          },
        }))

        if (hasSignature(prefix, lastEncoding)) {
          for (let i = encodings.length - 1; i >= 0; i--) {
            body = body.pipeThrough(new DecompressionStream(encodings[i]!))
          }
        }

        output = body.getReader()
      }

      const { done, value } = await output.read()

      if (done) {
        controller.close()
      }
      else {
        controller.enqueue(value)
      }
    },
    async cancel(reason) {
      await (output ?? reader).cancel(reason)
    },
  })
}

/**
 * An empty body carries no coding, so it never has a signature.
 */
function hasSignature(bytes: Uint8Array, encoding: SupportedEncoding): boolean {
  if (bytes.length < SIGNATURE_LENGTHS[encoding]) {
    return false
  }

  switch (encoding) {
    case 'gzip':
      // ID1, ID2, then CM = 8 (deflate), the only method defined
      // https://www.rfc-editor.org/rfc/rfc1952#section-2.3.1
      return bytes[0] === 0x1F && bytes[1] === 0x8B && bytes[2] === 0x08
    case 'deflate':
      // CM = 8 (deflate) with CINFO <= 7, and CMF * 256 + FLG must be a multiple of 31
      // https://www.rfc-editor.org/rfc/rfc1950#section-2.2
      return (bytes[0]! & 0x0F) === 0x08 && (bytes[0]! >> 4) <= 7 && ((bytes[0]! << 8) | bytes[1]!) % 31 === 0
    case 'deflate-raw':
      return true
  }
}

/**
 * Reads until at least `length` bytes are buffered or the stream ends.
 */
async function readPrefix(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0

  while (size < length) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
    size += value.length
  }

  if (chunks.length === 1) {
    return chunks[0]!
  }

  const prefix = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    prefix.set(chunk, offset)
    offset += chunk.length
  }

  return prefix
}
