import type { StandardHeaders, StandardResponse } from '@standard-server/core'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { isAsyncIteratorObject, stringifyJSON, toArray } from '@orpc/shared'
import { cancelStandardBody, generateContentDisposition } from '@standard-server/core'

/**
 * Answers `HEAD` requests with the procedure that would answer the same `GET` request,
 * as [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-head) expects, and
 * sends every `HEAD` response without a body, keeping its status and headers.
 * A procedure routed as `HEAD` still takes precedence over the `GET` fallback.
 *
 * @remarks
 * The fallback runs the `GET` procedure as a `GET` request, so interceptors that run
 * after routing see `GET`. The response keeps the `content-type` the `GET` response
 * would carry, and its `content-length` when known without consuming a stream.
 *
 * @see {@link https://orpc.dev/docs/plugins/head-method | HEAD Method Plugin}
 */
export class HeadMethodHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~head-method'

  /**
   * - `~tracing`: dropping the body cancels the traced stream, which ends the request span
   * - `~static-file`: procedures take precedence over files, as they do for `GET`
   * - `~response-compression`: the body is dropped after compression, so `HEAD` reports the same encoding as `GET`
   */
  after = ['~tracing', '~static-file', '~response-compression']

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const bodylessInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, request }) => {
      const result = await next()

      if (!result.matched || request.method !== 'HEAD') {
        return result
      }

      return { ...result, response: toBodylessResponse(result.response) }
    }

    const fallbackInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const result = await next()

      if (result.matched || interceptorOptions.request.method !== 'HEAD') {
        return result
      }

      return next({
        ...interceptorOptions,
        request: { ...interceptorOptions.request, method: 'GET' },
      })
    }

    return {
      ...options,
      routingInterceptors: [
        // Outermost, so the body is dropped only after every other interceptor shaped the response
        bodylessInterceptor,
        ...toArray(options.routingInterceptors),
        // Innermost, so a retry only repeats routing and never re-runs other interceptors
        fallbackInterceptor,
      ],
    }
  }
}

/**
 * Replaces the body with an empty stream rather than `undefined`, because the adapters
 * strip the content headers when the body is `undefined`. The headers the adapters would
 * derive from the original body are set explicitly, and an empty `standard-server` header
 * keeps the adapters from adding one the original body would not have carried.
 */
function toBodylessResponse(response: StandardResponse): StandardResponse {
  const { body } = response

  if (body === undefined) {
    return response
  }

  const headers: StandardHeaders = { ...response.headers }

  if (body instanceof ReadableStream) {
    // The adapters derive the same headers from the empty stream
    void cancelStandardBody(body).catch(() => {})
  }

  else if (body instanceof Blob) {
    headers['standard-server'] ??= 'file'
    headers['content-type'] ??= body.type
    headers['content-disposition'] ??= generateContentDisposition(body instanceof File ? body.name ?? '' : 'blob')

    if (Number.isFinite(body.size)) {
      headers['content-length'] = body.size.toString()
    }
  }

  else {
    headers['standard-server'] = []

    if (isAsyncIteratorObject(body)) {
      void cancelStandardBody(body).catch(() => {})

      headers['content-type'] = 'text/event-stream'
      headers['content-length'] = undefined
    }

    else if (body instanceof FormData) {
      // The boundary is random, so its length is only known by serializing every part
      headers['content-type'] = new Response(body).headers.get('content-type')!
      headers['content-length'] = undefined
    }

    else if (body instanceof URLSearchParams) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      // URL-encoded strings are ASCII, so every character is one byte
      headers['content-length'] = body.toString().length.toString()
    }

    else {
      headers['content-type'] = 'application/json'
      headers['content-length'] = new TextEncoder().encode(stringifyJSON(body)).byteLength.toString()
    }
  }

  return {
    ...response,
    headers,
    body: new ReadableStream({ start: controller => controller.close() }),
  }
}
