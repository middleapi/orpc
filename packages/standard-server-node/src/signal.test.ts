import http2 from 'node:http2'
import Stream from 'node:stream'
import { AbortError } from '@orpc/shared'
import { toAbortSignal } from './signal'

describe('toAbortSignal', async () => {
  it('on success', async () => {
    const stream = new Stream.Writable({
      write(chunk, encoding, callback) {
        callback()
      },
    })

    const signal = toAbortSignal(stream)

    expect(signal.aborted).toBe(false)

    stream.end('test')

    await new Promise<any>(r => setTimeout(r, 100))

    expect(signal.aborted).toBe(false)
  })

  it('on error', async () => {
    const stream = new Stream.Writable({
      write(chunk, encoding, callback) {
        callback()
      },
    })

    // catch error
    stream.on('error', () => {})

    const signal = toAbortSignal(stream)

    expect(signal.aborted).toBe(false)

    stream.destroy(new Error('test'))

    await vi.waitFor(() => {
      expect(signal.aborted).toEqual(true)
      expect(signal.reason).toEqual(new Error('test'))
    })
  })

  it('on writableFinished=false', async () => {
    const stream = new Stream.Writable({
      write(chunk, encoding, callback) {
      },
    })

    const signal = toAbortSignal(stream)

    expect(signal.aborted).toBe(false)

    stream.write('test')
    stream.destroy()

    await vi.waitFor(() => {
      expect(signal.aborted).toEqual(true)
      expect(signal.reason).toEqual(new AbortError('Writable stream closed before it finished writing'))
    })
  })

  it('on already errored', async () => {
    const stream = new Stream.Writable({
      write(chunk, encoding, callback) {
        callback()
      },
    })

    // catch error
    stream.on('error', () => {})

    stream.destroy(new Error('test'))

    const signal = toAbortSignal(stream)

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toEqual(new Error('test'))
  })

  it('on already closed before finished', async () => {
    const stream = new Stream.Writable({
      write(chunk, encoding, callback) {
      },
    })

    stream.write('test')
    stream.destroy()

    const signal = toAbortSignal(stream)

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toEqual(new AbortError('Writable stream closed before it finished writing'))
  })

  it('on http2 response with underlying stream already closed', async ({ onTestFinished }) => {
    const server = http2.createServer()
    onTestFinished(() => new Promise<any>(r => server.close(r)))

    const handled = new Promise<void>((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          // simulate a procedure still running when the client disconnects
          await new Promise<void>(r => res.stream.once('close', () => r()))

          const signal = toAbortSignal(res)

          expect(signal.aborted).toBe(true)
          expect(signal.reason).toEqual(new AbortError('Writable stream closed before it finished writing'))

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
})
