import type { NodeHttpHandlerPlugin } from './plugin'
import { CompositeNodeHttpHandlerPlugin } from './plugin'

describe('compositeNodeHttpHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards initNodeHttpHandlerOptions and sorts plugins by dependencies', () => {
    const plugin1 = {
      name: 'plugin-1',
      initNodeHttpHandlerOptions: vi.fn((options: any) => options),
      after: ['plugin-2'],
    } satisfies NodeHttpHandlerPlugin<any>

    const plugin2 = {
      name: 'plugin-2',
      initNodeHttpHandlerOptions: vi.fn((options: any) => options),
      before: ['plugin-1'],
    } satisfies NodeHttpHandlerPlugin<any>

    const plugin3 = {
      name: 'plugin-3',
      initNodeHttpHandlerOptions: vi.fn((options: any) => options),
      after: ['plugin-1'],
    } satisfies NodeHttpHandlerPlugin<any>

    const composite = new CompositeNodeHttpHandlerPlugin([plugin1, plugin2, plugin3])
    const options = { nodeHttpInterceptors: [vi.fn()] }

    const result = composite.initNodeHttpHandlerOptions(options)

    expect(result).toBe(options)

    expect(plugin1.initNodeHttpHandlerOptions).toHaveBeenCalledOnce()
    expect(plugin2.initNodeHttpHandlerOptions).toHaveBeenCalledOnce()
    expect(plugin3.initNodeHttpHandlerOptions).toHaveBeenCalledOnce()

    expect(plugin2.initNodeHttpHandlerOptions).toHaveBeenCalledBefore(plugin1.initNodeHttpHandlerOptions)
    expect(plugin1.initNodeHttpHandlerOptions).toHaveBeenCalledBefore(plugin3.initNodeHttpHandlerOptions)
  })
})
