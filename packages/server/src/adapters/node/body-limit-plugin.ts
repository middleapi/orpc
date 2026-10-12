import type { Context } from '../../context'
import type { NodeHttpHandlerOptions } from './handler'
import type { NodeHttpHandlerPlugin } from './plugin'
import { ORPCError } from '@orpc/client'
import { once } from '@orpc/shared'

export interface BodyLimitPluginOptions {
  /**
   * The maximum size of the body in bytes.
   */
  maxBodySize: number
}

/**
 * The Body Limit Plugin restricts the size of the request body for the Node.js HTTP Server.
 *
 * @see {@link https://orpc.dev/docs/plugins/body-limit Body Limit Plugin Docs}
 */
export class BodyLimitPlugin<T extends Context> implements NodeHttpHandlerPlugin<T> {
  private readonly maxBodySize: number

  constructor(options: BodyLimitPluginOptions) {
    this.maxBodySize = options.maxBodySize
  }

  initRuntimeAdapter(options: NodeHttpHandlerOptions<T>): void {
    options.adapterInterceptors ??= []

    options.adapterInterceptors.push(async (options) => {
      const throwPayloadTooLarge = () => {
        /**
         * The rest of the body is never read, so the connection cannot serve another request.
         * Tell keep-alive clients to drop it instead of reusing it (HTTP/2 forbids this header).
         */
        if (!('stream' in options.response) && !options.response.headersSent) {
          options.response.setHeader('connection', 'close')
        }

        throw new ORPCError('PAYLOAD_TOO_LARGE')
      }

      const checkHeader = once(() => {
        if (Number(options.request.headers['content-length']) > this.maxBodySize) {
          throwPayloadTooLarge()
        }
      })

      const originalEmit = options.request.emit

      let currentBodySize = 0

      options.request.emit = (event: string, ...args: any[]) => {
        if (event === 'data') {
          checkHeader()

          currentBodySize += args[0].length

          if (currentBodySize > this.maxBodySize) {
            throwPayloadTooLarge()
          }
        }

        return originalEmit.call(options.request, event, ...args)
      }

      try {
        return await options.next(options)
      }
      finally {
        options.request.emit = originalEmit
      }
    })
  }
}
