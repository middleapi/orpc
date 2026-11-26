import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { sleep } from '@orpc/shared'
import { describe, expect, it } from 'vitest'

import { fetchText, setFetchHandler, withTimeout } from './__shared__/fetch-handler'

const ping = os.meta(openapi({ method: 'POST', path: '/nested/ping' })).handler(() => 'pong')

describe.each([
  { name: 'RPCHandler', Handler: RPCHandler, output: '{"json":"pong"}' },
  { name: 'OpenAPIHandler', Handler: OpenAPIHandler, output: '"pong"' },
])('lazy router with $name', ({ Handler, output }) => {
  /**
   * Kept outside the fetch handler like a real Worker. The loader's first call waits on
   * a timer of the calling request, so it never settles once that request ends.
   */
  function setup() {
    let loads = 0

    const handler = new Handler({
      nested: os.lazy(async () => {
        if (++loads === 1) {
          await sleep(50)
        }

        return { default: { ping } }
      }),
    })

    setFetchHandler(async (request) => {
      const handling = handler.handle(request, { prefix: '/api', context: {} })

      if (new URL(request.url).searchParams.has('early')) {
        handling.catch(() => {})
        await sleep(20)
        return new Response('ended early')
      }

      const result = await withTimeout(handling)

      if (result === 'timeout' || !result.matched) {
        return new Response(result === 'timeout' ? result : 'not matched')
      }

      return new Response(await result.response.text())
    })

    return { loads: () => loads }
  }

  const call = (search = '') =>
    fetchText(`/api/nested/ping${search}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

  it('serves a request sent after the loading request ended', async () => {
    const { loads } = setup()

    expect(await call('?early')).toBe('ended early')
    expect(loads()).toBe(1)

    expect(await call()).toBe(output)
    expect(loads()).toBe(2)

    expect(await call()).toBe(output)
    expect(loads()).toBe(2)
  })

  it('serves concurrent requests after the loading request ended', async () => {
    const { loads } = setup()

    expect(await call('?early')).toBe('ended early')

    expect(await Promise.all([call(), call()])).toEqual([output, output])
    // each loads unless the other already indexed it
    const loadsAfter = loads()
    expect(loadsAfter).toBeGreaterThanOrEqual(2)
    expect(loadsAfter).toBeLessThanOrEqual(3)

    expect(await call()).toBe(output)
    expect(loads()).toBe(loadsAfter)
  })
})
