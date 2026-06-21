import type { ClientContext } from '../../types'
import type { StandardLinkPlugin } from '../standard'
import type { FetchLinkTransportOptions } from './transport'
import { sortPlugins } from '@orpc/shared'

export interface FetchLinkTransportPlugin<T extends ClientContext> extends StandardLinkPlugin<T> {
  initFetchLinkTransportOptions?(options: FetchLinkTransportOptions<T>): FetchLinkTransportOptions<T>
}

export class CompositeFetchLinkTransportPlugin<T extends ClientContext> implements FetchLinkTransportPlugin<T> {
  name = '~composite/fetch-link-transport'

  constructor(
    protected readonly plugins: FetchLinkTransportPlugin<T>[] = [],
  ) {
    this.plugins = sortPlugins(plugins)
  }

  initFetchLinkTransportOptions(options: FetchLinkTransportOptions<T>): FetchLinkTransportOptions<T> {
    for (const plugin of this.plugins) {
      if (plugin.initFetchLinkTransportOptions) {
        options = plugin.initFetchLinkTransportOptions(options)
      }
    }

    return options
  }
}
