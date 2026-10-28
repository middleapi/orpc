import type { StandardBody, StandardHeaders, StandardResponse } from '@standard-server/core'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { isAsyncIteratorObject, toArray } from '@orpc/shared'
import { cancelStandardBody, getRequiredStandardBodyHint } from '@standard-server/core'
import { toFetchBody } from '@standard-server/fetch'

const textEncoder = new TextEncoder()

/**
 * Answers `HEAD` requests with the headers of the matching `GET` procedure, like Fastify's
 * `exposeHeadRoutes`, so clients can check a resource's existence, type, and size without
 * downloading it. A procedure routed as `HEAD` itself takes precedence over the `GET` one.
 *
 * @remarks
 * - `HEAD` responses never carry a body: the plugin discards it, cancelling streams and
 *   event iterators, and keeps the headers it implies, such as `Content-Type`, and
 *   `Content-Length` when its size is known up front.
 * - `GET` procedures still need to be reachable, so with `RPCHandler`, `GET` must be in `allowMethods`.
 *
 * @see {@link https://orpc.dev/docs/plugins/head-method | HEAD Method Plugin}
 */
export class HeadMethodHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~head-method'

  /**
   * - Discard the body after response compression, so `HEAD` reports the same `Content-Encoding` as `GET`.
   * - Fall back to `GET` after static files, so they keep answering `HEAD` themselves and procedures still take precedence over them.
   */
  after = ['~response-compression', '~static-file']

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const bodyInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, request }) => {
      if (request.method !== 'HEAD') {
        return next()
      }

      const result = await next()

      if (!result.matched) {
        return result
      }

      return { ...result, response: toHeadResponse(result.response) }
    }

    /**
     * Placed last, so falling back to `GET` repeats routing rather than the routing interceptors before this one.
     */
    const fallbackInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const { request } = interceptorOptions

      if (request.method !== 'HEAD') {
        return next()
      }

      const result = await next()

      if (result.matched) {
        return result
      }

      return next({
        ...interceptorOptions,
        request: { ...request, method: 'GET' },
      })
    }

    return {
      ...options,
      routingInterceptors: [
        bodyInterceptor,
        ...toArray(options.routingInterceptors),
        fallbackInterceptor,
      ],
    }
  }
}

/**
 * Replaces the body with an empty stream, keeping the headers adapters derive from it.
 * An empty stream rather than no body, because adapters drop `Content-Length` when the body is `undefined`,
 * and an empty `Standard-Server` hint rather than none, so they do not hint the stream as `octet-stream`.
 */
function toHeadResponse(response: StandardResponse): StandardResponse {
  const { body } = response

  if (body === undefined) {
    return response
  }

  let headers: StandardHeaders

  if (body instanceof ReadableStream) {
    discardBody(body)
    headers = response.headers // adapters derive the same headers from any stream
  }

  else if (isAsyncIteratorObject(body)) {
    discardBody(body)

    // Encoding it would start iterating, so the headers are derived the way adapters do
    headers = { ...response.headers, 'content-length': undefined }
    headers['content-type'] ??= 'text/event-stream'
    headers['standard-server'] = getRequiredStandardBodyHint('event-stream', headers) ?? []
  }

  else if (body instanceof FormData) {
    // Only encoding it reveals the boundary. The size is left out, since it would require reading every file.
    const encoded = new Response(body)
    discardBody(encoded.body)

    headers = {
      ...response.headers,
      'standard-server': [],
      'content-type': encoded.headers.get('content-type')!,
      'content-length': undefined,
    }
  }

  else {
    const [encoded, encodedHeaders] = toFetchBody(body, response.headers)
    headers = encodedHeaders

    if (encoded instanceof ReadableStream) {
      discardBody(encoded) // a blob of unknown size
    }
    else if (typeof encoded === 'string' || encoded instanceof URLSearchParams) {
      headers['standard-server'] ??= []
      headers['content-length'] = textEncoder.encode(encoded.toString()).byteLength.toString()
    }
  }

  return { ...response, headers, body: createEmptyStream() }
}

function createEmptyStream(): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream({ start: controller => controller.close() })
}

/**
 * Nothing reads the body anymore, so a failure to cancel it has nowhere to go.
 */
function discardBody(body: StandardBody): void {
  cancelStandardBody(body).catch(() => {})
}
