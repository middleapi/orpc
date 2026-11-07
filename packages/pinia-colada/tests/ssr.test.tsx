import type { Client } from '@orpc/client'
import {
  hydrateQueryCache,
  PiniaColada,
  serializeQueryCache,
  useQuery,
  useQueryCache,
} from '@pinia/colada'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h, nextTick, ref, watch } from 'vue'
import { renderToString } from 'vue/server-renderer'

import type { RouterUtils } from '../src/index.ts'
import { createRouterUtils, StreamQuerySSRUtilsPlugin } from '../src/index.ts'
import { createChunkController } from './__shared__/utils.ts'

type StreamClient = { stream: Client<object, undefined, AsyncIterable<number>, Error> }

describe.each([
  [
    'streamed',
    (utils: RouterUtils<StreamClient>) => utils.stream.streamedOptions() as any,
    [],
    [1, 2],
    [[1], [1, 2]],
  ],
  [
    'live',
    (utils: RouterUtils<StreamClient>) => utils.stream.liveOptions() as any,
    1,
    [2, 3],
    [2, 3],
  ],
] as const)('ssr of %s queries', (_, options, serverData, events, browserData) => {
  const started = vi.fn()
  const server = createChunkController<number>()
  const browser = createChunkController<number>()

  async function renderOnServer() {
    const client = {
      stream: vi.fn(() => {
        started()
        return server.stream()
      }),
    } as unknown as StreamClient
    const utils = createRouterUtils(client, {
      plugins: [new StreamQuerySSRUtilsPlugin({ isServer: true })],
    })
    const pinia = createPinia()

    const app = createSSRApp(
      defineComponent({
        setup() {
          const query = useQuery(options(utils))
          return () => h('div', JSON.stringify(query.data.value))
        },
      }),
    )
      .use(pinia)
      .use(PiniaColada)

    server.push(1)
    const html = await renderToString(app)

    return { html, state: JSON.parse(JSON.stringify(serializeQueryCache(useQueryCache(pinia)))) }
  }

  it('reopens the stream on mount without going back to pending, and later components join it', async () => {
    const { html, state } = await renderOnServer()
    expect(html).toBe(`<div>${JSON.stringify(serverData)}</div>`)
    expect(started).toHaveBeenCalledTimes(1)

    const client = { stream: vi.fn(() => browser.stream()) } as unknown as StreamClient
    const utils = createRouterUtils(client, {
      plugins: [new StreamQuerySSRUtilsPlugin({ isServer: false })],
    })

    const statuses: string[] = []
    const queries: any[] = []
    const Consumer = defineComponent({
      setup() {
        const query = useQuery(options(utils))
        queries.push(query)
        watch(
          () => query.status.value,
          (status) => statuses.push(status),
          { flush: 'sync', immediate: true },
        )
        return () => null
      },
    })

    const showSecond = ref(false)
    const mounted = mount(
      defineComponent({
        setup: () => () => [h(Consumer), showSecond.value ? h(Consumer) : null],
      }),
      {
        global: {
          plugins: [
            createPinia(),
            PiniaColada,
            {
              install: (app) =>
                hydrateQueryCache(
                  app.runWithContext(() => useQueryCache()),
                  state,
                ),
            },
          ],
        },
      },
    )

    expect(queries[0].data.value).toEqual(serverData)
    await vi.waitFor(() => expect(client.stream).toHaveBeenCalledTimes(1), { interval: 1 })
    expect(queries[0].asyncStatus.value).toBe('loading')

    browser.push(events[0])
    await vi.waitFor(() => expect(queries[0].data.value).toEqual(browserData[0]), { interval: 1 })

    showSecond.value = true
    await nextTick()
    expect(queries[1].data.value).toEqual(browserData[0])

    browser.push(events[1])
    await vi.waitFor(() => expect(queries[1].data.value).toEqual(browserData[1]), { interval: 1 })
    expect(queries[0].data.value).toEqual(browserData[1])
    expect(queries[0].asyncStatus.value).toBe('loading')

    expect(client.stream).toHaveBeenCalledTimes(1)
    expect(statuses).not.toContain('pending')

    mounted.unmount()
  })
})
