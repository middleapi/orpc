import type { Context } from '../../context'
import type { StandardHandlerPlugin } from '../standard'
import type { FetchHandlerOptions } from './handler'
import { sortPlugins } from '@orpc/shared'

export interface FetchHandlerPlugin<T extends Context> extends StandardHandlerPlugin<T> {
  /**
   * Initializes the plugin and returns new fetch handler options.
   * Called once per plugin instance during composition.
   *
   * This method allows plugins to wrap, extend, or transform fetch handler options
   * such as fetch interceptors, or fetch configuration.
   *
   * @param options - The current handler options from previous plugins or base configuration
   * @returns Transformed handler options with plugin's modifications applied
   *
   * @example
   * ```ts
   * initFetchHandlerOptions(options) {
   *   return {
   *     ...options,
   *     interceptors: [...(options.interceptors || []), myInterceptor]
   *   }
   * }
   * ```
   */
  initFetchHandlerOptions?(options: FetchHandlerOptions<T>): FetchHandlerOptions<T>
}

export class CompositeFetchHandlerPlugin<T extends Context> implements FetchHandlerPlugin<T> {
  readonly name = '~composite/fetch-handler'

  protected readonly plugins: FetchHandlerPlugin<T>[]

  constructor(plugins: FetchHandlerPlugin<T>[] = []) {
    this.plugins = sortPlugins(plugins)
  }

  initFetchHandlerOptions(options: FetchHandlerOptions<T>): FetchHandlerOptions<T> {
    for (const plugin of this.plugins) {
      if (plugin.initFetchHandlerOptions) {
        options = plugin.initFetchHandlerOptions(options)
      }
    }

    return options
  }
}
