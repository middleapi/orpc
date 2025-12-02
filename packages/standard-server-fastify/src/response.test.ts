import { Readable } from 'node:stream'
import FastifyCookie from '@fastify/cookie'
import * as StandardServerNode from '@orpc/standard-server-node'
import Fastify from 'fastify'
import request from 'supertest'
import { sendStandardResponse } from './response'

const toNodeHttpBodySpy = vi.spyOn(StandardServerNode, 'toNodeHttpBody')
const toNodeHttpHeadersSpy = vi.spyOn(StandardServerNode, 'toNodeHttpHeaders')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendStandardResponse', () => {
  it('chunked (empty)', async ({ onTestFinished }) => {
    let sendSpy: any

    const fastify = Fastify()
    onTestFinished(() => fastify.close())

    const options = { eventIteratorKeepAliveEnabled: true }
    fastify.get('/', async (req, reply) => {
      sendSpy = vi.spyOn(reply, 'send')

      await sendStandardResponse(reply, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: undefined,
      }, options)
    })

    await fastify.ready()
    const res = await request(fastify.server).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith(undefined, {
      'x-custom-header': 'custom-value',
    }, options)

    expect(toNodeHttpHeadersSpy).toBeCalledTimes(1)
    expect(toNodeHttpHeadersSpy).toBeCalledWith({
      'x-custom-header': 'custom-value',
    })

    expect(sendSpy).toBeCalledTimes(1)
    expect(sendSpy).toBeCalledWith(undefined)

    expect(res.status).toBe(207)
    expect(res.headers).not.toHaveProperty('content-type')
    expect(res.headers['x-custom-header']).toEqual('custom-value')

    expect(res.text).toEqual('')
  })

  it('chunked', async ({ onTestFinished }) => {
    let sendSpy: any

    const fastify = Fastify()
    onTestFinished(() => fastify.close())

    const options = { eventIteratorKeepAliveEnabled: true }
    fastify.get('/', async (req, reply) => {
      sendSpy = vi.spyOn(reply, 'send')

      await sendStandardResponse(reply, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: { foo: 'bar' },
      }, options)
    })

    await fastify.ready()
    const res = await request(fastify.server).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith({ foo: 'bar' }, {
      'content-type': 'application/json',
      'x-custom-header': 'custom-value',
    }, options)

    expect(toNodeHttpHeadersSpy).toBeCalledTimes(1)
    expect(toNodeHttpHeadersSpy).toBeCalledWith({
      'content-type': 'application/json',
      'x-custom-header': 'custom-value',
    })

    expect(sendSpy).toBeCalledTimes(1)
    expect(sendSpy).toBeCalledWith(toNodeHttpBodySpy.mock.results[0]!.value)

    expect(res.status).toBe(207)
    expect(res.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'x-custom-header': 'custom-value',
    })

    expect(res.body).toEqual({ foo: 'bar' })
  })

  it('stream (file)', async ({ onTestFinished }) => {
    const blob = new Blob(['foo'], { type: 'text/plain' })
    let sendSpy: any

    const fastify = Fastify()
    onTestFinished(() => fastify.close())

    const options = { eventIteratorKeepAliveEnabled: true }
    fastify.get('/', async (req, reply) => {
      sendSpy = vi.spyOn(reply, 'send')

      await sendStandardResponse(reply, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: blob,
      }, options)
    })

    await fastify.ready()
    const res = await request(fastify.server).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith(blob, {
      'content-disposition': 'inline; filename="blob"; filename*=utf-8\'\'blob',
      'content-length': '3',
      'content-type': 'text/plain',
      'x-custom-header': 'custom-value',
    }, options)

    expect(toNodeHttpHeadersSpy).toBeCalledTimes(1)
    expect(toNodeHttpHeadersSpy).toBeCalledWith({
      'content-disposition': 'inline; filename="blob"; filename*=utf-8\'\'blob',
      'content-length': '3',
      'content-type': 'text/plain',
      'x-custom-header': 'custom-value',
    })

    expect(sendSpy).toBeCalledTimes(1)
    expect(sendSpy).toBeCalledWith(toNodeHttpBodySpy.mock.results[0]!.value)

    expect(res.status).toBe(207)
    expect(res.headers).toMatchObject({
      'content-disposition': 'inline; filename="blob"; filename*=utf-8\'\'blob',
      'content-length': '3',
      'content-type': 'text/plain',
      'x-custom-header': 'custom-value',
    })

    expect(res.text).toEqual('foo')
  })

  it('stream (async generator)', async ({ onTestFinished }) => {
    async function* gen() {
      yield 'foo'
      yield 'bar'
      return 'baz'
    }

    const generator = gen()

    let sendSpy: any

    const fastify = Fastify()
    onTestFinished(() => fastify.close())

    const options = { eventIteratorKeepAliveEnabled: true }
    fastify.get('/', async (req, reply) => {
      sendSpy = vi.spyOn(reply, 'send')

      await sendStandardResponse(reply, {
        status: 207,
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: generator,
      }, options)
    })

    await fastify.ready()
    const res = await request(fastify.server).get('/')

    expect(toNodeHttpBodySpy).toBeCalledTimes(1)
    expect(toNodeHttpBodySpy).toBeCalledWith(generator, {
      'content-type': 'text/event-stream',
      'x-custom-header': 'custom-value',
    }, options)

    expect(toNodeHttpHeadersSpy).toBeCalledTimes(1)
    expect(toNodeHttpHeadersSpy).toBeCalledWith({
      'content-type': 'text/event-stream',
      'x-custom-header': 'custom-value',
    })

    expect(sendSpy).toBeCalledTimes(1)
    expect(sendSpy).toBeCalledWith(toNodeHttpBodySpy.mock.results[0]!.value)

    expect(res.status).toBe(207)
    expect(res.headers).toMatchObject({
      'content-type': 'text/event-stream',
      'x-custom-header': 'custom-value',
    })

    expect(res.text).toEqual(': \n\nevent: message\ndata: "foo"\n\nevent: message\ndata: "bar"\n\nevent: done\ndata: "baz"\n\n')
  })

  describe('edge case', () => {
    it('error while pulling stream', async ({ onTestFinished }) => {
      const fastify = Fastify()
      onTestFinished(() => fastify.close())

      toNodeHttpBodySpy.mockReturnValueOnce(Readable.fromWeb(new ReadableStream({
        async pull(controller) {
          controller.enqueue(new TextEncoder().encode('foo'))
          await new Promise(r => setTimeout(r, 100))
          controller.error(new Error('foo'))
        },
      })))

      const options = { eventIteratorKeepAliveEnabled: true }
      fastify.get('/', async (req, reply) => {
        await sendStandardResponse(reply, {
          status: 207,
          headers: {
            'x-custom-header': 'custom-value',
          },
          async* body() { },
        }, options)
      })

      await fastify.ready()
      await expect(request(fastify.server).get('/')).rejects.toThrow()
    })

    it('request aborted while pulling stream', async ({ onTestFinished }) => {
      const cancelMock = vi.fn()

      const fastify = Fastify()
      onTestFinished(() => fastify.close())

      toNodeHttpBodySpy.mockReturnValueOnce(Readable.fromWeb(new ReadableStream({
        async pull(controller) {
          controller.enqueue(new TextEncoder().encode('foo'))
          await new Promise(r => setTimeout(r, 100))
        },
        cancel: cancelMock,
      })))

      const options = { eventIteratorKeepAliveEnabled: true }
      fastify.get('/', async (req, reply) => {
        await sendStandardResponse(reply, {
          status: 207,
          headers: {
            'x-custom-header': 'custom-value',
          },
          async* body() { },
        }, options)
      })

      await fastify.ready()
      const res = request(fastify.server).get('/')

      setTimeout(() => {
        res.abort()
      }, 100)

      await expect(res).rejects.toThrow()

      await vi.waitFor(() => {
        expect(cancelMock).toHaveBeenCalledTimes(1)
      })
    })

    it('work with @fastify/cookie', async ({ onTestFinished }) => {
      const fastify = Fastify()
      onTestFinished(() => fastify.close())

      await fastify.register(FastifyCookie)

      fastify.get('/', async (req, reply) => {
        reply.cookie('foo', 'bar')
        await sendStandardResponse(reply, {
          status: 207,
          headers: {},
          body: { foo: 'bar' },
        })
      })

      await fastify.ready()
      const res = await request(fastify.server).get('/')

      expect(res.headers).toMatchObject({
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': [
          expect.stringContaining('foo=bar'),
        ],
      })

      expect(res.text).toEqual(JSON.stringify({ foo: 'bar' }))
    })
  })
})
