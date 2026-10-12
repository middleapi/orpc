import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import http from 'node:http'
import http2 from 'node:http2'
import request from 'supertest'
import { os } from '../../builder'
import { BodyLimitPlugin } from './body-limit-plugin'
import { RPCHandler } from './rpc-handler'

describe('bodyLimitPlugin', () => {
  const size22Json = { json: { foo: 'bar' } }

  it('should work if body size is not exceeded', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'ping'), {
        plugins: [
          new BodyLimitPlugin({ maxBodySize: 22 }),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .send(size22Json)

    expect(res.text).toContain('ping')
    expect(res.status).toBe(200)
  })

  it('check the content-length', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'ping'), {
        plugins: [
          new BodyLimitPlugin({ maxBodySize: 21 }),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .send(size22Json)
      .set('content-length', '22')

    expect(res.text).toContain('PAYLOAD_TOO_LARGE')
    expect(res.status).toBe(413)
  })

  it('check the body-size', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'ping'), {
        plugins: [
          new BodyLimitPlugin({ maxBodySize: 21 }),
        ],
      })

      delete req.headers['content-length']

      await handler.handle(req, res)
    })
      .post('/')
      .send(size22Json)

    expect(res.text).toContain('PAYLOAD_TOO_LARGE')
    expect(res.status).toBe(413)
  })

  it.each([
    ['content-length', true],
    ['body-size', false],
  ])('closes the connection after rejecting by %s so keep-alive clients do not reuse it', async (_, withContentLength) => {
    const handler = new RPCHandler(os.handler(() => 'ping'), {
      plugins: [
        new BodyLimitPlugin({ maxBodySize: 1024 }),
      ],
    })

    const server = http.createServer(async (req, res) => {
      await handler.handle(req, res)
    })
    onTestFinished(() => new Promise<any>(r => server.close(r)))
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    onTestFinished(() => agent.destroy())

    const post = (body: string, chunked = false) => new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request({ port, method: 'POST', agent, headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume()
        res.on('end', () => resolve(res))
      })
      req.on('error', reject)

      if (chunked) {
        req.write(body)
        req.end()
      }
      else {
        req.end(body)
      }
    })

    const rejected = await post(JSON.stringify({ json: 'x'.repeat(100 * 1024) }), !withContentLength)
    expect(rejected.statusCode).toBe(413)
    expect(rejected.headers.connection).toBe('close')

    const next = await post(JSON.stringify(size22Json))
    expect(next.statusCode).toBe(200)
  })

  it('does not set the connection header on http2', async () => {
    const handler = new RPCHandler(os.handler(() => 'ping'), {
      plugins: [
        new BodyLimitPlugin({ maxBodySize: 21 }),
      ],
    })

    let setHeaderSpy: any
    const server = http2.createServer(async (req, res) => {
      setHeaderSpy = vi.spyOn(res, 'setHeader')
      await handler.handle(req, res)
    })
    onTestFinished(() => new Promise<any>(r => server.close(r)))
    await new Promise<void>(r => server.listen(0, r))

    const client = http2.connect(`http://localhost:${(server.address() as AddressInfo).port}`)
    onTestFinished(() => client.close())

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = client.request({ ':method': 'POST', 'content-type': 'application/json' })
      let status: number | undefined
      req.on('response', headers => status = headers[':status'])
      req.on('error', reject)
      req.resume()
      req.on('end', () => resolve(status))
      req.end(JSON.stringify(size22Json))
    })

    expect(status).toBe(413)
    expect(setHeaderSpy).not.toHaveBeenCalledWith('connection', expect.anything())
  })
})
