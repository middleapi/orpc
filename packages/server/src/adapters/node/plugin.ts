import type { Context } from '../../context'
import type { StandardHandlerPlugin } from '../standard'
import type { NodeHttpHandlerOptions } from './handler'
import { sortPlugins } from '@orpc/shared'

export interface NodeHttpHandlerPlugin<T extends Context> extends StandardHandlerPlugin<T> {
  /**
   * Initializes the plugin and returns new node HTTP handler options.
   * Called once per plugin instance during composition.
   *
   * This method allows plugins to wrap, extend, or transform node HTTP handler options
   * such as interceptors, or other configuration.
   *
   * @param options - The current handler options from previous plugins or base configuration
   * @returns Transformed handler options with plugin's modifications applied
   *
   * @example
   * ```ts
   * initNodeHttpHandlerOptions(options) {
   *   return {
   *     ...options,
   *     nodeHttpInterceptors: [...(options.nodeHttpInterceptors || []), myInterceptor]
   *   }
   * }
   * ```
   */
  initNodeHttpHandlerOptions?(options: NodeHttpHandlerOptions<T>): NodeHttpHandlerOptions<T>
}

export class CompositeNodeHttpHandlerPlugin<T extends Context> implements NodeHttpHandlerPlugin<T> {
  readonly name = '~composite/node-http-handler'

  protected readonly plugins: NodeHttpHandlerPlugin<T>[]

  constructor(plugins: NodeHttpHandlerPlugin<T>[] = []) {
    this.plugins = sortPlugins(plugins)
  }

  initNodeHttpHandlerOptions(options: NodeHttpHandlerOptions<T>): NodeHttpHandlerOptions<T> {
    for (const plugin of this.plugins) {
      if (plugin.initNodeHttpHandlerOptions) {
        options = plugin.initNodeHttpHandlerOptions(options)
      }
    }

    return options
  }
}
