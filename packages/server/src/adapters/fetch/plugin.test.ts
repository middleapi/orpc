import type { FetchHandlerPlugin } from './plugin'
import { CompositeFetchHandlerPlugin } from './plugin'

describe('compositeFetchHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards initFetchHandlerOptions and sorts plugins by dependencies', () => {
    const plugin1 = {
      name: 'plugin-1',
      initFetchHandlerOptions: vi.fn((options: any) => options),
      after: ['plugin-2'],
    } satisfies FetchHandlerPlugin<any>

    const plugin2 = {
      name: 'plugin-2',
      initFetchHandlerOptions: vi.fn((options: any) => options),
      before: ['plugin-1'],
    } satisfies FetchHandlerPlugin<any>

    const plugin3 = {
      name: 'plugin-3',
      initFetchHandlerOptions: vi.fn((options: any) => options),
      after: ['plugin-1'],
    } satisfies FetchHandlerPlugin<any>

    const compositePlugin = new CompositeFetchHandlerPlugin([plugin1, plugin2, plugin3])
    const options = { fetchInterceptors: [vi.fn()] }

    const result = compositePlugin.initFetchHandlerOptions(options)

    expect(result).toBe(options)

    expect(plugin1.initFetchHandlerOptions).toHaveBeenCalledOnce()
    expect(plugin2.initFetchHandlerOptions).toHaveBeenCalledOnce()
    expect(plugin3.initFetchHandlerOptions).toHaveBeenCalledOnce()

    expect(plugin2.initFetchHandlerOptions).toHaveBeenCalledBefore(plugin1.initFetchHandlerOptions)
    expect(plugin1.initFetchHandlerOptions).toHaveBeenCalledBefore(plugin3.initFetchHandlerOptions)
  })
})
