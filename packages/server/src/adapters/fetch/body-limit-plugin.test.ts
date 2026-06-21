import { os } from '../../builder'
import { BodyLimitHandlerPlugin } from './body-limit-plugin'
import { RPCHandler } from './rpc-handler'

describe('bodyLimitHandlerPlugin', () => {
  const size22Json = { json: { foo: 'bar' } }

  it('ignores requests without a body', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 22 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping?data=%7B%7D'))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('ping')
    expect(response!.status).toBe(200)
  })

  it('allows bodies within the limit', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 22 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(size22Json),
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('ping')
    expect(response!.status).toBe(200)
  })

  it('checks the content-length header', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-length': '22',
      },
      body: JSON.stringify({}),
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
    expect(response!.status).toBe(413)
  })

  it('checks the streamed body size', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const { matched, response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(size22Json),
    }))

    expect(matched).toBe(true)
    await expect(response!.text()).resolves.toContain('PAYLOAD_TOO_LARGE')
    expect(response!.status).toBe(413)
  })
})
