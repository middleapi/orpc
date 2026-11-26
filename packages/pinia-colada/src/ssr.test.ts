import type { Client } from '@orpc/client'

import { createQueryCache } from '../tests/__shared__/utils'
import { createRouterUtils } from './router-utils'
import { StreamQuerySSRUtilsPlugin } from './ssr'

describe('streamQuerySSRUtilsPlugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [true, { settleOnFirstData: true }],
    [false, { staleTime: 0 }],
  ] as const)(
    'injects options with isServer: %s, given or detected by window',
    (isServer, defaults) => {
      const expected = { streamedOptions: defaults, liveOptions: defaults }

      expect(new StreamQuerySSRUtilsPlugin({ isServer }).initProcedureOptions([], {})).toEqual(
        expected,
      )

      if (!isServer) {
        vi.stubGlobal('window', {})
      }
      expect(new StreamQuerySSRUtilsPlugin().initProcedureOptions([], {})).toEqual(expected)
    },
  )

  it('detects Deno as the server', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('Deno', {})

    expect(new StreamQuerySSRUtilsPlugin().initProcedureOptions([], {})).toEqual({
      streamedOptions: { settleOnFirstData: true },
      liveOptions: { settleOnFirstData: true },
    })
  })

  it('lets utils and call options override its defaults', async () => {
    const cleanup = vi.fn()
    const client = {
      stream: vi.fn(async function* () {
        try {
          yield 1
          yield 2
        } finally {
          cleanup()
        }
      }),
    } as unknown as { stream: Client<object, undefined, AsyncIterable<number>, Error> }

    const plugin = new StreamQuerySSRUtilsPlugin({ isServer: true })

    expect(
      plugin.initProcedureOptions([], {
        streamedOptions: { settleOnFirstData: false, staleTime: 1000 },
      }),
    ).toEqual({
      streamedOptions: { settleOnFirstData: false, staleTime: 1000 },
      liveOptions: { settleOnFirstData: true },
    })

    const utils = createRouterUtils(client, { plugins: [plugin] })
    const queryCache = createQueryCache()

    const options = utils.stream.streamedOptions({ settleOnFirstData: false, staleTime: 1000 })
    expect(options.staleTime).toBe(1000)

    await expect(queryCache.fetch(queryCache.ensure(options))).resolves.toMatchObject({
      data: [1, 2],
    })
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
