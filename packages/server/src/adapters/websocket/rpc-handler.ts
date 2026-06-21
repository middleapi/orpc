import type { Context } from '../../context'
import type { Router } from '../../router'
import type { RPCHandlerCodecOptions, StandardHandlerOptions } from '../standard'
import type { WebsocketHandlerOptions } from './handler'
import { RPCHandlerCodec, StandardHandler } from '../standard'
import { WebsocketHandler } from './handler'

export interface RPCHandlerOptions<T extends Context>
  extends StandardHandlerOptions<T>, RPCHandlerCodecOptions<T>, WebsocketHandlerOptions<T> {}

export class RPCHandler<T extends Context> extends WebsocketHandler<T> {
  constructor(
    router: Router<T>,
    options: NoInfer<RPCHandlerOptions<T>> = {},
  ) {
    const codec = new RPCHandlerCodec(router, options)
    const handler = new StandardHandler(codec, options)
    super(handler, options)
  }
}
