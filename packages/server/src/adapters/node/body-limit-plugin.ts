import type { Context } from '../../context'
import type { NodeHttpHandlerOptions } from './handler'
import type { NodeHttpHandlerPlugin } from './plugin'
import { ORPCError } from '@orpc/client'
import { toArray } from '@orpc/shared'

export interface BodyLimitHandlerPluginOptions {
  /**
   * The maximum size of the body in bytes.
   */
  maxBodySize: number
}

export class BodyLimitHandlerPlugin<T extends Context> implements NodeHttpHandlerPlugin<T> {
  name = '~body-limit'

  private readonly maxBodySize: number

  constructor(options: BodyLimitHandlerPluginOptions) {
    this.maxBodySize = options.maxBodySize
  }

  initNodeHttpHandlerOptions(options: NodeHttpHandlerOptions<T>): NodeHttpHandlerOptions<T> {
    return {
      ...options,
      nodeHttpInterceptors: [
        async (interceptorOptions) => {
          let isHeaderChecked = false
          const checkHeader = () => {
            if (isHeaderChecked) {
              return
            }

            isHeaderChecked = true

            const contentLength = interceptorOptions.request.headers['content-length']
            if (contentLength && Number(contentLength) > this.maxBodySize) {
              throw new ORPCError('PAYLOAD_TOO_LARGE')
            }
          }

          const originalEmit = interceptorOptions.request.emit

          let currentBodySize = 0
          interceptorOptions.request.emit = (event: string, ...args: any[]) => {
            if (event === 'data') {
              checkHeader()

              currentBodySize += args[0]?.length ?? 0
              if (currentBodySize > this.maxBodySize) {
                throw new ORPCError('PAYLOAD_TOO_LARGE')
              }
            }

            return originalEmit.call(interceptorOptions.request, event, ...args)
          }

          try {
            return await interceptorOptions.next(interceptorOptions)
          }
          finally {
            interceptorOptions.request.emit = originalEmit
          }
        },
        ...toArray(options.nodeHttpInterceptors),
      ],
    }
  }
}
