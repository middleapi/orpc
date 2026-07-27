import http from 'node:http'
import http2 from 'node:http2'
import { connect } from 'node:net'
import { isNodeResponseStreamEnded } from './utils'

describe('isNodeResponseStreamEnded', () => {
  it('on http1 response aborted by client', async ({ onTestFinished }) => {
    const server = http.createServer()
    onTestFinished(() => new Promise<any>(r => server.close(r)))

    const handled = new Promise<void>((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          expect(isNodeResponseStreamEnded(res)).toBe(false)

          await new Promise<void>(r => res.once('close', () => r()))

          expect(isNodeResponseStreamEnded(res)).toBe(true)

          resolve()
        }
        catch (error) {
          reject(error)
        }
      })
    })

    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port

    const socket = connect(port, '127.0.0.1', () => {
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n')

      setTimeout(() => {
        socket.destroy()
      }, 50)
    })

    await handled
  })

  it('on http1 response finished normally', async ({ onTestFinished }) => {
    const server = http.createServer()
    onTestFinished(() => new Promise<any>(r => server.close(r)))

    const handled = new Promise<void>((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          expect(isNodeResponseStreamEnded(res)).toBe(false)

          res.end('ok')

          await vi.waitFor(() => {
            expect(isNodeResponseStreamEnded(res)).toBe(true)
          })

          resolve()
        }
        catch (error) {
          reject(error)
        }
      })
    })

    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port

    http.get(`http://localhost:${port}`, res => res.resume())

    await handled
  })

  it('on http2 response aborted by client', async ({ onTestFinished }) => {
    const server = http2.createServer()
    onTestFinished(() => new Promise<any>(r => server.close(r)))

    const handled = new Promise<void>((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          expect(isNodeResponseStreamEnded(res)).toBe(false)

          await new Promise<void>(r => res.stream.once('close', () => r()))

          expect(isNodeResponseStreamEnded(res)).toBe(true)

          resolve()
        }
        catch (error) {
          reject(error)
        }
      })
    })

    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port

    const client = http2.connect(`http://localhost:${port}`)
    const reqStream = client.request({ ':path': '/' })
    reqStream.once('error', () => {})

    setTimeout(() => {
      reqStream.close(http2.constants.NGHTTP2_CANCEL)
      client.close()
    }, 50)

    await handled
  })

  it('on http2 response finished normally', async ({ onTestFinished }) => {
    const server = http2.createServer()
    onTestFinished(() => new Promise<any>(r => server.close(r)))

    const handled = new Promise<void>((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          expect(isNodeResponseStreamEnded(res)).toBe(false)

          res.end('ok')

          await vi.waitFor(() => {
            expect(isNodeResponseStreamEnded(res)).toBe(true)
          })

          resolve()
        }
        catch (error) {
          reject(error)
        }
      })
    })

    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as any).port

    const client = http2.connect(`http://localhost:${port}`)
    const reqStream = client.request({ ':path': '/' })
    reqStream.on('data', () => {})
    reqStream.once('end', () => client.close())

    await handled
  })
})
