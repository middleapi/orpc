import type { Context } from '../../context'
import type { FetchHandlerOptions } from './handler'
import type { FetchHandlerPlugin } from './plugin'
import { ORPCError } from '@orpc/client'
import { toArray } from '@orpc/shared'

export interface BodyLimitHandlerPluginOptions {
  /**
   * The maximum size of the body in bytes.
   */
  maxBodySize: number
}

export class BodyLimitHandlerPlugin<T extends Context> implements FetchHandlerPlugin<T> {
  name = '~body-limit'

  private readonly maxBodySize: number

  constructor(options: BodyLimitHandlerPluginOptions) {
    this.maxBodySize = options.maxBodySize
  }

  initFetchHandlerOptions(options: FetchHandlerOptions<T>): FetchHandlerOptions<T> {
    return {
      ...options,
      fetchInterceptors: [
        async (interceptorOptions) => {
          if (!interceptorOptions.request.body) {
            return interceptorOptions.next()
          }

          let currentBodySize = 0
          const rawReader = interceptorOptions.request.body.getReader()

          const body = new ReadableStream<Uint8Array>({
            start: async (controller) => {
              const reject = async (error: unknown) => {
                controller.error(error)
                await rawReader.cancel(error)
              }

              const contentLength = interceptorOptions.request.headers.get('content-length')
              if (contentLength && Number(contentLength) > this.maxBodySize) {
                await reject(new ORPCError('PAYLOAD_TOO_LARGE'))
                return
              }

              while (true) {
                const { done, value } = await rawReader.read()

                if (done) {
                  controller.close()
                  return
                }

                currentBodySize += value.length
                if (currentBodySize > this.maxBodySize) {
                  await reject(new ORPCError('PAYLOAD_TOO_LARGE'))
                  return
                }

                controller.enqueue(value)
              }
            },
          })

          const requestInit: RequestInit & { duplex: 'half' } = { body, duplex: 'half' }

          return interceptorOptions.next({
            ...interceptorOptions,
            request: new Request(interceptorOptions.request, requestInit),
          })
        },
        ...toArray(options.fetchInterceptors),
      ],
    }
  }
}
