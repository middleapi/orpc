import type { NodeHttpRequest, NodeHttpResponse } from '@standardserver/node'
import type { Context } from '../../context'
import type { NodeHttpHandlerOptions } from './handler'
import type { NodeHttpHandlerPlugin } from './plugin'
import compression from '@orpc/interop/compression'
import { toArray } from '@orpc/shared'

export interface BodyCompressionHandlerPluginOptions extends compression.CompressionOptions {
  /**
   * Override the default content-type filter used to determine which responses should be compressed.
   *
   * @warning Event stream responses are never compressed, regardless of this filter's return value.
   * @default only responses with compressible content types are compressed.
   */
  filter?: (request: NodeHttpRequest, response: NodeHttpResponse) => boolean
}

export class BodyCompressionHandlerPlugin<T extends Context> implements NodeHttpHandlerPlugin<T> {
  name = '~body-compression'

  private readonly compressionHandler: ReturnType<typeof compression>

  constructor(options: BodyCompressionHandlerPluginOptions = {}) {
    this.compressionHandler = compression({
      ...options,
      filter: (request, response) => {
        const hasContentDisposition = response.hasHeader('content-disposition')
        const contentType = response.getHeader('content-type')?.toString()

        if (!hasContentDisposition && contentType?.startsWith('text/event-stream')) {
          return false
        }

        return options.filter
          ? options.filter(request, response)
          : compression.filter(request, response)
      },
    })
  }

  initNodeHttpHandlerOptions(options: NodeHttpHandlerOptions<T>): NodeHttpHandlerOptions<T> {
    return {
      ...options,
      nodeHttpInterceptors: [
        async (interceptorOptions) => {
          let resolve!: (value: Awaited<ReturnType<typeof interceptorOptions.next>>) => void
          let reject!: (reason?: any) => void
          const promise = new Promise<Awaited<ReturnType<typeof interceptorOptions.next>>>((res, rej) => {
            resolve = res
            reject = rej
          })

          const originalWrite = interceptorOptions.response.write
          const originalEnd = interceptorOptions.response.end
          const originalOn = interceptorOptions.response.on

          this.compressionHandler(
            interceptorOptions.request as any,
            interceptorOptions.response as any,
            async (error) => {
              /* v8 ignore next 3 - mirrored from the upstream compression handler callback contract */
              if (error) {
                reject(error)
              }
              else {
                try {
                  resolve(await interceptorOptions.next(interceptorOptions))
                }
                catch (nextError) {
                  reject(nextError)
                }
              }
            },
          )

          try {
            return await promise
          }
          finally {
            interceptorOptions.response.write = originalWrite
            interceptorOptions.response.end = originalEnd
            interceptorOptions.response.on = originalOn
          }
        },
        ...toArray(options.nodeHttpInterceptors),
      ],
    }
  }
}
