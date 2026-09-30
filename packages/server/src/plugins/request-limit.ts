import type { StandardBody } from '@standard-server/core'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '../adapters/standard'
import type { Context } from '../context'
import { ORPCError } from '@orpc/client'
import { isAsyncIteratorObject, override, stringifyJSON, toArray, wrapAsyncIterator } from '@orpc/shared'
import { flattenStandardHeader, getEventMeta } from '@standard-server/core'
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
 * A body the adapter has already decoded, as peer adapters such as WebSocket and
 * MessagePort always do, is measured by its decoded size instead, and an
 * `AsyncIteratorObject` body value by value as it is read.
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
          async resolveBody(hint) {
            const contentLength = Number(
              flattenStandardHeader(interceptorOptions.request.headers['content-length']),
            )

            if (Number.isFinite(contentLength) && contentLength > maxBodySize) {
              throw new ORPCError('PAYLOAD_TOO_LARGE')
            }

            const stream = await interceptorOptions.request.resolveBody('octet-stream')

            /**
             * Adapters that ignore the hint return an already decoded body: peer
             * adapters always do, and so does a Node.js adapter whose framework
             * parsed the body first.
             */
            if (!(stream instanceof ReadableStream)) {
              return limitDecodedBody(stream, maxBodySize)
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
              headers: toFetchHeaders(interceptorOptions.request.headers),
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

const textEncoder = new TextEncoder()

/**
 * Limits a body the adapter has already decoded. An `AsyncIteratorObject` is
 * measured value by value as it is read, and fails the read that exceeds the limit.
 */
function limitDecodedBody(body: StandardBody, maxBodySize: number): StandardBody {
  if (isAsyncIteratorObject(body)) {
    let currentBodySize = 0

    /**
     * @warning
     * Remember use `override` for AsyncIteratorObject to remain other special properties
     */
    return override(body, wrapAsyncIterator(body, {
      mapResult: (result) => {
        currentBodySize += measureDecodedBody(result.value, maxBodySize - currentBodySize)
        currentBodySize += measureDecodedBody(getEventMeta(result.value), maxBodySize - currentBodySize)

        if (currentBodySize > maxBodySize) {
          throw new ORPCError('PAYLOAD_TOO_LARGE')
        }

        return result
      },
    }))
  }

  if (measureDecodedBody(body, maxBodySize) > maxBodySize) {
    throw new ORPCError('PAYLOAD_TOO_LARGE')
  }

  return body
}

/**
 * Measures a decoded body in bytes: the size of its JSON encoding for plain data, the
 * byte length for binary data, and the entries of other containers, such as `FormData`
 * or a `Map`, measured like an array. A value reachable more than once, as structured
 * clone allows, counts once. Measuring stops once the size passes `limit`, so an
 * oversized body costs about as much to reject as one at the limit.
 */
function measureDecodedBody(body: unknown, limit: number): number {
  const visited = new WeakSet<object>()
  const stack = [body]
  let size = 0

  while (stack.length !== 0 && size <= limit) {
    const value = stack.pop()

    if (typeof value === 'string') {
      size += measureJsonString(value, limit - size)
      continue
    }

    if (typeof value !== 'object' || value === null) {
      // Values JSON drops, such as `undefined`, take no space
      if (value !== undefined && typeof value !== 'function' && typeof value !== 'symbol') {
        size += String(value).length
      }

      continue
    }

    if (visited.has(value)) {
      continue
    }

    visited.add(value)

    if (value instanceof Blob) {
      size += value.size
      continue
    }

    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      size += value.byteLength
      continue
    }

    // Brackets plus a separator per item, as JSON encodes arrays and objects
    let isEmpty = true
    size += 1

    if (Symbol.iterator in value) {
      for (const item of value as Iterable<unknown>) {
        isEmpty = false
        size += 1
        stack.push(item)

        if (size > limit) {
          break
        }
      }
    }
    else {
      for (const key in value) {
        if (!Object.hasOwn(value, key)) {
          continue
        }

        isEmpty = false
        size += measureJsonString(key, limit - size) + 2
        stack.push((value as Record<string, unknown>)[key])

        if (size > limit) {
          break
        }
      }
    }

    if (isEmpty) {
      size += 1
    }
  }

  return size
}

function measureJsonString(value: string, limit: number): number {
  // Every UTF-16 code unit takes at least one byte, so a longer string cannot fit
  if (value.length + 2 > limit) {
    return value.length + 2
  }

  return textEncoder.encode(stringifyJSON(value)).byteLength
}
