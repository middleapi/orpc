import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { OpenRPCHandler } from './openrpc-handler'

function createRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('openRPCHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts context and prefix options in handle method', async () => {
    const contextHandler = new OpenRPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const { matched, response } = await contextHandler.handle(
      createRequest('https://example.com/api/v1', { jsonrpc: '2.0', method: 'ping', id: 1 }),
      {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      },
    )

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: 'u_123' })

    const misMatchPrefixResult = await contextHandler.handle(
      createRequest('https://example.com/invalid', { jsonrpc: '2.0', method: 'ping', id: 1 }),
      {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      },
    )

    expect(misMatchPrefixResult.matched).toBe(false)
    expect(misMatchPrefixResult.response).toBeUndefined()
  })

  it('passes options to the codec and the envelope plugin', async () => {
    const handler = new OpenRPCHandler({
      ping: os.handler(() => 'pong'),
      hidden: os.handler(() => 'hidden'),
      find: os.handler(() => {
        throw new ORPCError('NOT_FOUND')
      }),
    }, {
      filter: (_, path) => path[0] !== 'hidden',
      errorCodeMap: { NOT_FOUND: 404 },
      maxBatchSize: 1,
    })

    const call = async (body: unknown) => {
      const { response } = await handler.handle(createRequest('https://example.com/rpc', body), { prefix: '/rpc' })
      return { status: response!.status, json: await response!.json() }
    }

    await expect(call({ jsonrpc: '2.0', method: 'hidden', id: 1 })).resolves.toMatchObject({ status: 200, json: { error: { code: -32601 } } })
    await expect(call({ jsonrpc: '2.0', method: 'find', id: 1 })).resolves.toMatchObject({ status: 200, json: { error: { code: 404 } } })
    // the error code map replaces the common one, for the errors of the envelope too
    await expect(call([{ jsonrpc: '2.0', method: 'ping', id: 1 }, { jsonrpc: '2.0', method: 'ping', id: 2 }]))
      .resolves
      .toMatchObject({ status: 413, json: { error: { code: -32000, data: { code: 'PAYLOAD_TOO_LARGE' } } } })
  })

  it('supports standard handler plugins', async () => {
    const plugin: StandardHandlerPlugin<any> = {
      name: 'test',
      init(options) {
        return {
          ...options,
          routingInterceptors: [
            async () => ({ matched: true, response: { status: 200, headers: {}, body: 'intercepted' } }),
          ],
        }
      },
    }

    const handler = new OpenRPCHandler({}, { plugins: [plugin] })

    const { matched, response } = await handler.handle(new Request('https://example.com/test'))

    expect(matched).toBe(true)
    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(200)
    return expect(response!.text()).resolves.toBe('"intercepted"')
  })
})
