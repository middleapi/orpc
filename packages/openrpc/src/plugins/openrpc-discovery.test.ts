import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { OpenRPCHandler } from '../adapters/fetch'
import { OpenRPCDiscoveryHandlerPlugin } from './openrpc-discovery'

const spec = { openrpc: '1.3.2', info: { title: 'Planets', version: '1.0.0' }, methods: [] }

describe('openRPCDiscoveryHandlerPlugin', () => {
  const discover = vi.fn()
  const handler = new OpenRPCHandler({ rpc: { discover: os.handler(discover) } }, {
    plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: () => spec })],
  })

  async function call(body: unknown) {
    const { response } = await handler.handle(new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), { prefix: '/rpc' })

    return response!.status === 204 ? undefined : response!.json()
  }

  it('answers rpc.discover', async () => {
    await expect(call({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 })).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: spec })
    await expect(call([{ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }])).resolves.toEqual([{ jsonrpc: '2.0', id: 1, result: spec }])
    await expect(call({ jsonrpc: '2.0', method: 'rpc.discover' })).resolves.toBeUndefined()
    expect(discover).not.toHaveBeenCalled()
  })

  it('serves the document over GET', async () => {
    const { response } = await handler.handle(new Request('http://localhost/rpc/openrpc.json'), { prefix: '/rpc' })
    await expect(response!.json()).resolves.toEqual(spec)

    const disabled = new OpenRPCHandler({}, { plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: false })] })
    expect((await disabled.handle(new Request('http://localhost/openrpc.json'))).matched).toBe(false)
  })

  it('serves the document with other handlers', async () => {
    const rpc = new RPCHandler({}, { plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec, specPath: '/spec.json' })] })
    const { response } = await rpc.handle(new Request('http://localhost/spec.json'))

    await expect(response!.json()).resolves.toEqual(spec)
  })
})
