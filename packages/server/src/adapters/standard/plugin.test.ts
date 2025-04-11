import type { StandardHandlerPlugin } from './plugin'
import { CompositeStandardHandlerPlugin } from './plugin'

describe('compositeStandardHandlerPlugin', () => {
  it('forward init and sort plugins', () => {
    const plugin1 = {
      init: vi.fn(),
      order: 1,
    } satisfies StandardHandlerPlugin<any>
    const plugin2 = {
      init: vi.fn(),
    } satisfies StandardHandlerPlugin<any>
    const plugin3 = {
      init: vi.fn(),
      order: -1,
    } satisfies StandardHandlerPlugin<any>

    const compositePlugin = new CompositeStandardHandlerPlugin([plugin1, plugin2, plugin3])

    const interceptor = vi.fn()

    const options = { interceptors: [interceptor] }

    compositePlugin.init(options)

    expect(plugin1.init).toHaveBeenCalledOnce()
    expect(plugin2.init).toHaveBeenCalledOnce()
    expect(plugin3.init).toHaveBeenCalledOnce()

    expect(plugin1.init.mock.calls[0]![0]).toBe(options)
    expect(plugin2.init.mock.calls[0]![0]).toBe(options)
    expect(plugin3.init.mock.calls[0]![0]).toBe(options)

    expect(plugin3.init).toHaveBeenCalledBefore(plugin2.init)
    expect(plugin2.init).toHaveBeenCalledBefore(plugin1.init)
  })
})
