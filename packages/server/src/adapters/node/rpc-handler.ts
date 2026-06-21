import type { Context } from '../../context'
import type { Router } from '../../router'
import type { RPCHandlerCodecOptions, StandardHandlerOptions } from '../standard'
import type { NodeHttpHandlerOptions } from './handler'
import { toArray } from '@orpc/shared'
import { CSRFGuardHandlerPlugin } from '../../plugins'
import { RPCHandlerCodec, StandardHandler } from '../standard'
import { NodeHttpHandler } from './handler'

export interface RPCHandlerOptions<T extends Context>
  extends NodeHttpHandlerOptions<T>, Omit<StandardHandlerOptions<T>, 'plugins'>, RPCHandlerCodecOptions<T> {

  /**
   * Configuration for {@link CSRFGuardHandlerPlugin}, which is enabled by default for `RPCHandler` over HTTP.
   */
  csrfGuardPlugin?: {
    /**
     * If `false`, this plugin is disabled.
     *
     * @default true
     */
    enabled?: boolean
  }
}

export class RPCHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(
    router: Router<T>,
    options: NoInfer<RPCHandlerOptions<T>> = {},
  ) {
    if (options.csrfGuardPlugin?.enabled !== false) {
      options = {
        ...options,
        plugins: [...toArray(options.plugins), new CSRFGuardHandlerPlugin()],
      }
    }

    const codec = new RPCHandlerCodec(router, options)
    const handler = new StandardHandler(codec, options)
    super(handler, options)
  }
}
