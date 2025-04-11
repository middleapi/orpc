import type { Context } from '../../context'
import type { Router } from '../../router'
import type { StandardRPCHandlerOptions } from '../standard'
import type { FetchHandlerOptions } from './handler'
import { StandardRPCHandler } from '../standard'
import { FetchHandler } from './handler'

export class RPCHandler<T extends Context> extends FetchHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<FetchHandlerOptions<T> & StandardRPCHandlerOptions<T>> = {}) {
    super(new StandardRPCHandler(router, options), options)
  }
}
