import type { Context } from '../../context'
import type { StandardHandlerPlugin } from '../standard'
import type { FetchHandlerOptions } from './handler'
import { CompositeStandardHandlerPlugin } from '../standard'

export interface FetchHandlerPlugin<T extends Context> extends StandardHandlerPlugin<T> {
  initRuntimeAdapter?(options: FetchHandlerOptions<T>): void
}

export class CompositeFetchHandlerPlugin<T extends Context, TPlugin extends FetchHandlerPlugin<T>>
  extends CompositeStandardHandlerPlugin<T, TPlugin> implements FetchHandlerPlugin<T> {
  initRuntimeAdapter(options: FetchHandlerOptions<T>): void {
    for (const plugin of this.plugins) {
      plugin.initRuntimeAdapter?.(options)
    }
  }
}
