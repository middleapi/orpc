import type { Context } from '../../context'
import type { Router } from '../../router'
import type { RPCHandlerCodecOptions, StandardHandlerOptions } from '../standard'
import type { FetchHandlerOptions } from './handler'
import { toArray } from '@orpc/shared'
import { CSRFGuardHandlerPlugin } from '../../plugins'
import { RPCHandlerCodec, StandardHandler } from '../standard'
import { FetchHandler } from './handler'

export interface RPCHandlerOptions<T extends Context>
  extends FetchHandlerOptions<T>, Omit<StandardHandlerOptions<T>, 'plugins'>, RPCHandlerCodecOptions<T> {
  /**
   * Configuration for {@link CSRFGuardHandlerPlugin}, which is enabled by default for `RPCHandler` over HTTP.
   */
  csrfGuardHandlerPlugin?: {
    /**
     * If `false`, this plugin is disabled.
     *
     * @default true
     */
    enabled?: boolean
  }
}

export class RPCHandler<T extends Context> extends FetchHandler<T> {
  constructor(
    router: Router<T>,
    options: NoInfer<RPCHandlerOptions<T>> = {},
  ) {
    if (options.csrfGuardHandlerPlugin?.enabled !== false) {
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
