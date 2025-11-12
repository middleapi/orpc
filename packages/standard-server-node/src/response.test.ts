import type { StandardResponse } from '@orpc/standard-server'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import Stream from 'node:stream'
import request from 'supertest'
import * as Body from './body'
import { sendStandardResponse } from './response'

const toNodeHttpBodySpy = vi.spyOn(Body, 'toNodeHttpBody')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendStandardResponse', () => {
  it('chunked (empty)', async () => {
    let endSpy: any

    const options = { eventIteratorKeepAliveEnabled: true }
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      endSpy = vi.spyOn(res, 'end')

      await sendStandardResponse(res, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: undefined,
      }, options)
    }).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith(undefined, {
      'x-custom-header': 'custom-value',
    }, options)

    expect(endSpy).toBeCalledTimes(1)
    expect(endSpy).toBeCalledWith()

    expect(res.status).toBe(207)
    expect(res.headers['content-type']).toEqual(undefined)
    expect(res.headers['x-custom-header']).toEqual('custom-value')

    expect(res.text).toEqual('')
  })

  it('chunked', async () => {
    let endSpy: any

    const options = { eventIteratorKeepAliveEnabled: true }
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      endSpy = vi.spyOn(res, 'end')

      await sendStandardResponse(res, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: { foo: 'bar' },
      }, options)
    }).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith({ foo: 'bar' }, {
      'content-type': 'application/json',
      'x-custom-header': 'custom-value',
    }, options)

    expect(endSpy).toBeCalledTimes(1)
    expect(endSpy).toBeCalledWith(toNodeHttpBodySpy.mock.results[0]!.value)

    expect(res.status).toBe(207)
    expect(res.headers).toMatchObject({
      'content-type': 'application/json',
      'x-custom-header': 'custom-value',
    })

    expect(res.body).toEqual({ foo: 'bar' })
  })

  it('stream (file)', async () => {
    const blob = new Blob(['foo'], { type: 'text/plain' })
    let endSpy: any

    const options = { eventIteratorKeepAliveEnabled: true }
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      endSpy = vi.spyOn(res, 'end')

      await sendStandardResponse(res, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: blob,
      }, options)
    }).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith(blob, {
      'content-disposition': 'inline; filename="blob"; filename*=utf-8\'\'blob',
      'content-length': '3',
      'content-type': 'text/plain',
      'x-custom-header': 'custom-value',
    }, options)

    expect(endSpy).toBeCalledTimes(1)
    expect(endSpy).toBeCalledWith()

    expect(res.status).toBe(207)
    expect(res.headers).toMatchObject({
      'content-disposition': 'inline; filename="blob"; filename*=utf-8\'\'blob',
      'content-length': '3',
      'content-type': 'text/plain',
      'x-custom-header': 'custom-value',
    })

    expect(res.text).toEqual('foo')
  })

  it('stream (async generator)', async () => {
    async function* gen() {
      yield 'foo'
      yield 'bar'
      return 'baz'
    }

    const generator = gen()

    let endSpy: any

    const options = { eventIteratorKeepAliveEnabled: true }

    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      endSpy = vi.spyOn(res, 'end')

      await sendStandardResponse(res, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: generator,
      }, options)
    }).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith(generator, {
      'content-type': 'text/event-stream',
      'x-custom-header': 'custom-value',
    }, options)

    expect(endSpy).toBeCalledTimes(1)
    expect(endSpy).toBeCalledWith()

    expect(res.status).toBe(207)
    expect(res.headers).toMatchObject({
      'content-type': 'text/event-stream',
      'x-custom-header': 'custom-value',
    })

    expect(res.text).toEqual(': \n\nevent: message\ndata: "foo"\n\nevent: message\ndata: "bar"\n\nevent: done\ndata: "baz"\n\n')
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

        ;(responseStream as any).writeHead = vi.fn()

      const sendPromise = expect(sendStandardResponse(responseStream as any, res)).rejects.toThrow('test')

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

     ;(responseStream as any).writeHead = vi.fn()

      const sendPromise = sendStandardResponse(responseStream as any, res)

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
