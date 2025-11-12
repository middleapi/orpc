import type { StandardResponse } from '@orpc/standard-server'
import { Buffer } from 'node:buffer'
import Stream from 'node:stream'
import * as Body from './body'
import { sendStandardResponse } from './response'

const toLambdaBodySpy = vi.spyOn(Body, 'toLambdaBody')

beforeEach(() => {
  vi.clearAllMocks()

  globalThis.awslambda = {
    HttpResponseStream: {
      from: vi.fn(stream => stream),
    },
  } as any
})

describe('sendStandardResponse', () => {
  it('chunked (empty)', async () => {
    const res: StandardResponse = {
      body: undefined,
      headers: {
        'x-custom-header': 'custom-value',
        'set-cookie': ['foo=bar', 'bar=baz'],
      },
      status: 206,
    }

    const chunks: any[] = []
    const responseStream = new Stream.Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk)
        callback()
      },
    })

    await sendStandardResponse(responseStream, res, { eventIteratorKeepAliveComment: 'test' })

    expect(toLambdaBodySpy).toBeCalledTimes(1)
    expect(toLambdaBodySpy).toBeCalledWith(res.body, res.headers, { eventIteratorKeepAliveComment: 'test' })

    expect(awslambda.HttpResponseStream.from).toBeCalledTimes(1)
    expect(awslambda.HttpResponseStream.from).toBeCalledWith(responseStream, {
      statusCode: res.status,
      headers: {
        'x-custom-header': 'custom-value',
      },
      cookies: res.headers['set-cookie'],
    })

    expect(chunks).toEqual([])
    expect(responseStream.closed).toBe(true)
  })

  it('chunked (string)', async () => {
    const res: StandardResponse = {
      body: { value: 123 },
      headers: {
        'x-custom-header': 'custom-value',
        'set-cookie': ['foo=bar', 'bar=baz'],
      },
      status: 206,
    }

    const chunks: any[] = []
    const responseStream = new Stream.Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk)
        callback()
      },
    })

    await sendStandardResponse(responseStream, res, { eventIteratorKeepAliveComment: 'test' })

    expect(toLambdaBodySpy).toBeCalledTimes(1)
    expect(toLambdaBodySpy).toBeCalledWith(res.body, res.headers, { eventIteratorKeepAliveComment: 'test' })

    expect(awslambda.HttpResponseStream.from).toBeCalledTimes(1)
    expect(awslambda.HttpResponseStream.from).toBeCalledWith(responseStream, {
      statusCode: res.status,
      headers: {
        'content-type': 'application/json',
        'x-custom-header': 'custom-value',
      },
      cookies: res.headers['set-cookie'],
    })

    expect(chunks).toEqual([
      Buffer.from(JSON.stringify({ value: 123 })),
    ])

    expect(responseStream.closed).toBe(true)
  })

  it('stream', async () => {
    const res: StandardResponse = {
      body: (async function* () {
        yield 'foo'
        yield 'bar'
      })(),
      headers: {
        'x-custom-header': 'custom-value',
        'set-cookie': ['foo=bar', 'bar=baz'],
      },
      status: 206,
    }

    const chunks: any[] = []
    const responseStream = new Stream.Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk)
        callback()
      },
    })

    await sendStandardResponse(responseStream, res, { eventIteratorKeepAliveComment: 'test' })

    expect(toLambdaBodySpy).toBeCalledTimes(1)
    expect(toLambdaBodySpy).toBeCalledWith(res.body, res.headers, { eventIteratorKeepAliveComment: 'test' })

    expect(awslambda.HttpResponseStream.from).toBeCalledTimes(1)
    expect(awslambda.HttpResponseStream.from).toBeCalledWith(responseStream, {
      statusCode: res.status,
      headers: {
        'content-type': 'text/event-stream',
        'x-custom-header': 'custom-value',
      },
      cookies: res.headers['set-cookie'],
    })

    expect(chunks).toEqual([
      Buffer.from(': \n\n'),
      Buffer.from('event: message\ndata: "foo"\n\n'),
      Buffer.from('event: message\ndata: "bar"\n\n'),
    ])

    expect(responseStream.closed).toBe(true)
  })

  describe('stream destroy while sending', () => {
    it('with error', async () => {
      let clean = false
      const res: StandardResponse = {
        body: (async function* () {
          try {
            yield 1
            await new Promise(r => setTimeout(r, 100))
            yield 2
            await new Promise(r => setTimeout(r, 100))
            yield 3
            await new Promise(r => setTimeout(r, 9999999))
            yield 4
          }
          finally {
            clean = true
          }
        })(),
        headers: {
          'x-custom-header': 'custom-value',
          'set-cookie': ['foo=bar', 'bar=baz'],
        },
        status: 206,
      }

      const chunks: any[] = []
      const responseStream = new Stream.Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk)
          callback()
        },
      })

      const sendPromise = expect(sendStandardResponse(responseStream, res, { eventIteratorKeepAliveComment: 'test' })).rejects.toThrow('test')

      await new Promise(r => setTimeout(r, 110))

      expect(chunks).toEqual([
        Buffer.from(': \n\n'),
        Buffer.from('event: message\ndata: 1\n\n'),
        Buffer.from('event: message\ndata: 2\n\n'),
      ])

      expect(responseStream.closed).toBe(false)
      expect(clean).toBe(false)

      responseStream.destroy(new Error('test'))

      await vi.waitFor(() => {
        expect(responseStream.closed).toBe(true)
        expect(clean).toBe(true)
      })

      await sendPromise
    })

    it('without error', async () => {
      let clean = false
      const res: StandardResponse = {
        body: (async function* () {
          try {
            yield 1
            await new Promise(r => setTimeout(r, 100))
            yield 2
            await new Promise(r => setTimeout(r, 100))
            yield 3
            await new Promise(r => setTimeout(r, 9999999))
            yield 4
          }
          finally {
            clean = true
          }
        })(),
        headers: {
          'x-custom-header': 'custom-value',
          'set-cookie': ['foo=bar', 'bar=baz'],
        },
        status: 206,
      }

      const chunks: any[] = []
      const responseStream = new Stream.Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk)
          callback()
        },
      })

      const sendPromise = sendStandardResponse(responseStream, res, { eventIteratorKeepAliveComment: 'test' })

      await new Promise(r => setTimeout(r, 110))

      expect(chunks).toEqual([
        Buffer.from(': \n\n'),
        Buffer.from('event: message\ndata: 1\n\n'),
        Buffer.from('event: message\ndata: 2\n\n'),
      ])

      expect(responseStream.closed).toBe(false)
      expect(clean).toBe(false)

      responseStream.destroy()

      await vi.waitFor(() => {
        expect(responseStream.closed).toBe(true)
        expect(clean).toBe(true)
      })

      await sendPromise
    })
  })
})
