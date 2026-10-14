import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

describe('rpcHandler', () => {
  const handler = new RPCHandler({
    ping: os.route({ method: 'GET' }).handler(({ input }) => ({ output: input })),
    pong: os.handler(({ input }) => ({ output: input })),
  })

  it('works', async () => {
    const { response } = await handler.handle(new Request('https://example.com/api/v1/ping?data=%7B%22json%22%3A%22value%22%7D'), {
      prefix: '/api/v1',
    })

    await expect(response?.text()).resolves.toContain('value')
    expect(response?.status).toBe(200)
  })

  it('enable StrictGetMethodPlugin by default', async () => {
    const { response } = await handler.handle(new Request('https://example.com/api/v1/pong?data=%7B%22json%22%3A%22value%22%7D'), {
      prefix: '/api/v1',
    })

    expect(response!.status).toEqual(405)
  })

  it('rejects an oversized bigint string with 400 before running middleware', async () => {
    const middleware = vi.fn(({ next }) => next())
    const handler = new RPCHandler({ ping: os.use(middleware).handler(() => 'pong') })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: '9'.repeat(1_000_000), meta: [[0]] }),
    }))

    expect(response?.status).toBe(400)
    expect(middleware).not.toHaveBeenCalled()
  })
})
