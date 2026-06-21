import type { FetchLinkTransportPlugin } from './plugin'
import { CompositeFetchLinkTransportPlugin } from './plugin'

describe('compositeFetchLinkTransportPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards initFetchLinkTransportOptions and sorts plugins by dependencies', () => {
    const plugin1 = {
      name: 'plugin-1',
      initFetchLinkTransportOptions: vi.fn((options: any) => options),
      after: ['plugin-2'],
    } satisfies FetchLinkTransportPlugin<any>

    const plugin2 = {
      name: 'plugin-2',
      initFetchLinkTransportOptions: vi.fn((options: any) => options),
      before: ['plugin-1'],
    } satisfies FetchLinkTransportPlugin<any>

    const plugin3 = {
      name: 'plugin-3',
      after: ['plugin-1'],
    } satisfies FetchLinkTransportPlugin<any>

    const compositePlugin = new CompositeFetchLinkTransportPlugin([plugin1, plugin2, plugin3])
    const options = { fetchInterceptors: [vi.fn()] }

    const result = compositePlugin.initFetchLinkTransportOptions(options)

    expect(result).toBe(options)

    expect(plugin1.initFetchLinkTransportOptions).toHaveBeenCalledOnce()
    expect(plugin2.initFetchLinkTransportOptions).toHaveBeenCalledOnce()

    expect(plugin2.initFetchLinkTransportOptions).toHaveBeenCalledBefore(plugin1.initFetchLinkTransportOptions)
  })
})
