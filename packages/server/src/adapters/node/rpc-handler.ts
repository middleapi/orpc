import type { Context } from '../../context'
import type { Router } from '../../router'
import type { StandardRPCHandlerOptions } from '../standard'
import type { NodeHttpHandlerOptions } from './handler'
import { StandardRPCHandler } from '../standard'
import { NodeHttpHandler } from './handler'

export class RPCHandler<T extends Context> extends NodeHttpHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<StandardRPCHandlerOptions<T> & NodeHttpHandlerOptions<T>> = {}) {
    super(new StandardRPCHandler(router, options), options)
  }
}
