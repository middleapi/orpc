import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { sleep } from '@orpc/shared'
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { setFetchHandler } from './__shared__/fetch-handler'

const ping = os.meta(openapi({ method: 'POST', path: '/nested/ping' })).handler(() => 'pong')

const setups = [
  {
    name: 'RPCHandler',
    createHandler: (router: any) => new RPCHandler(router),
    output: '{"json":"pong"}',
  },
  {
    name: 'OpenAPIHandler',
    createHandler: (router: any) => new OpenAPIHandler(router),
    output: '"pong"',
  },
] as const

describe.each(setups)('lazy router with $name', ({ createHandler, output }) => {
  afterEach(() => {
    setFetchHandler(undefined)
  })

  /**
   * Kept outside the fetch handler like a real Worker. The loader's first call waits on
   * a timer of the calling request, later calls resolve at once.
   */
  function setup() {
    let loaderCalls = 0

    const router = {
      nested: os.lazy(async () => {
        if (++loaderCalls === 1) {
          await sleep(200)
        }

        return { default: { ping } }
      }),
    }

    const handler = createHandler(router)

    async function handle(request: Request): Promise<Response> {
      const { matched, response } = await handler.handle(request, {
        prefix: '/api',
        context: {},
      })

      return matched ? response : new Response('not matched', { status: 404 })
    }

    setFetchHandler(async (request) => {
      const url = new URL(request.url)

      // starts the work, then responds before the lazy load finishes
      if (url.pathname.startsWith('/early/')) {
        const forwarded = new Request(new URL(url.pathname.slice('/early'.length), url), request)
        const result = await Promise.race([handle(forwarded), sleep(20).then(() => undefined)])
        return new Response(result === undefined ? 'ended early' : 'finished')
      }

      const result = await Promise.race([
        handle(request),
        sleep(1000).then(() => 'timeout' as const),
      ])

      if (result === 'timeout') {
        return new Response('timeout', { status: 504 })
      }

      return new Response(`${result.status}:${await result.text()}`)
    })

    return {
      get loaderCalls() {
        return loaderCalls
      },
    }
  }

  function call(path = '/api/nested/ping') {
    return exports.default.fetch(`http://x${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
  }

  async function expectPong() {
    const response = await call()
    expect(await response.text()).toBe(`200:${output}`)
  }

  it('serves a request sent while an ended request is still loading the router', async () => {
    const state = setup()

    const early = await call('/early/api/nested/ping')
    expect(await early.text()).toBe('ended early')
    expect(state.loaderCalls).toBe(1)

    await expectPong()
    expect(state.loaderCalls).toBe(2)

    await expectPong()
    expect(state.loaderCalls).toBe(2)
  })

  it('serves a request sent after the loading request ended', async () => {
    const state = setup()

    const early = await call('/early/api/nested/ping')
    expect(await early.text()).toBe('ended early')

    // past the first load's timer, which never fires since its request ended
    await sleep(300)
    expect(state.loaderCalls).toBe(1)

    await expectPong()
    expect(state.loaderCalls).toBe(2)

    await expectPong()
    expect(state.loaderCalls).toBe(2)
  })

  it('serves concurrent requests while an ended request is still loading the router', async () => {
    const state = setup()

    const early = await call('/early/api/nested/ping')
    expect(await early.text()).toBe('ended early')

    const responses = await Promise.all([call(), call()])
    expect(await Promise.all(responses.map((r) => r.text()))).toEqual([
      `200:${output}`,
      `200:${output}`,
    ])
    // each loads unless the other already indexed it
    const loaderCalls = state.loaderCalls
    expect(loaderCalls).toBeGreaterThanOrEqual(2)
    expect(loaderCalls).toBeLessThanOrEqual(3)

    await expectPong()
    expect(state.loaderCalls).toBe(loaderCalls)
  })
})
