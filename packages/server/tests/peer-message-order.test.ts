import { decodeResponseMessage, encodeRequestMessage, MessageType } from '@orpc/standard-server-peer'
import { os } from '../src'
import { RPCHandler as BunWsRPCHandler } from '../src/adapters/bun-ws'
import { experimental_RPCHandler as CrosswsRPCHandler } from '../src/adapters/crossws'
import { RPCHandler as MessagePortRPCHandler } from '../src/adapters/message-port'
import { RPCHandler as WebsocketRPCHandler } from '../src/adapters/websocket'
import { RPCHandler as WsRPCHandler } from '../src/adapters/ws'

/**
 * A request message takes longer to decode than the event iterator messages after it,
 * so adapters must keep the order or the first input values are lost.
 */
describe('peer adapters keep the message order', async () => {
  const values = Array.from({ length: 30 }, (_, i) => i)

  const router = {
    collect: os.handler(async ({ input }) => {
      const received: unknown[] = []
      for await (const value of input as AsyncIterable<unknown>) {
        received.push(value)
      }
      return received
    }),
  }

  const messages = [
    await encodeRequestMessage('1', MessageType.REQUEST, {
      url: new URL('http://orpc/collect'),
      headers: {},
      method: 'POST',
      body: (async function* () {})(),
    }),
    ...await Promise.all(values.map(value => encodeRequestMessage('1', MessageType.EVENT_ITERATOR, {
      event: 'message',
      data: { json: value },
    }))),
    await encodeRequestMessage('1', MessageType.EVENT_ITERATOR, { event: 'done', data: { json: undefined } }),
  ] as string[]

  async function expectResponse(send: { mock: { calls: any[][] } }) {
    await vi.waitFor(() => expect(send.mock.calls.length).toBe(1))
    const [, , response] = await decodeResponseMessage(send.mock.calls[0]![0])
    expect(response).toEqual(expect.objectContaining({ body: { json: values } }))
  }

  it('ws', async () => {
    let onMessage: any
    const ws = {
      addEventListener: vi.fn((event, callback) => {
        if (event === 'message') {
          onMessage = callback
        }
      }),
      send: vi.fn(),
    }

    new WsRPCHandler(router).upgrade(ws as any)
    messages.forEach(data => onMessage({ data }))

    await expectResponse(ws.send)
  })

  it('websocket', async () => {
    const ws = { addEventListener: vi.fn(), send: vi.fn() }
    const handler = new WebsocketRPCHandler(router)
    messages.forEach(data => handler.message(ws, data))

    await expectResponse(ws.send)
  })

  it('crossws', async () => {
    const ws = { send: vi.fn() }
    const handler = new CrosswsRPCHandler(router)
    messages.forEach(rawData => handler.message(ws, { rawData } as any))

    await expectResponse(ws.send)
  })

  it('bun-ws', async () => {
    const ws = { send: vi.fn() }
    const handler = new BunWsRPCHandler(router)
    messages.forEach(data => handler.message(ws, data))

    await expectResponse(ws.send)
  })

  it('message-port', async () => {
    let onMessage: any
    const port = {
      addEventListener: vi.fn((event, callback) => {
        if (event === 'message') {
          onMessage = callback
        }
      }),
      postMessage: vi.fn(),
      start: vi.fn(),
    }

    new MessagePortRPCHandler(router).upgrade(port as any)
    messages.forEach(data => onMessage({ data }))

    await expectResponse(port.postMessage)
  })
})
