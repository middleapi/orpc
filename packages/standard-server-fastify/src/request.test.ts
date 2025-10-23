import type { StandardLazyRequest } from '@orpc/standard-server'
import * as StandardServerNode from '@orpc/standard-server-node'
import Fastify from 'fastify'
import request from 'supertest'
import { toStandardLazyRequest } from './request'

const toStandardBodySpy = vi.spyOn(StandardServerNode, 'toStandardBody')
const toStandardMethodSpy = vi.spyOn(StandardServerNode, 'toStandardMethod')
const toStandardUrlSpy = vi.spyOn(StandardServerNode, 'toStandardUrl')
const toAbortSignalSpy = vi.spyOn(StandardServerNode, 'toAbortSignal')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toStandardLazyRequest', () => {
  it('works & prefer fastify parsed body', async ({ onTestFinished }) => {
    let fastifyReq: any
    let fastifyReply: any
    let standardRequest: any
    let standardBody: any

    const fastify = Fastify()
    onTestFinished(() => fastify.close())

    fastify.all('/', async (req, reply) => {
      fastifyReq = req
      fastifyReply = reply
      standardRequest = toStandardLazyRequest(req, reply)
      standardBody = await standardRequest.body()
    })

    await fastify.ready()
    // fastify has its own json body parser
    await request(fastify.server).post('/').send({ foo: 'bar' })

    expect(toStandardBodySpy).toBeCalledTimes(0)
    expect(standardBody).toEqual({ foo: 'bar' })

    expect(standardRequest.headers).toBe(fastifyReq.raw.headers)

    expect(toAbortSignalSpy).toBeCalledTimes(1)
    expect(toAbortSignalSpy).toBeCalledWith(fastifyReply.raw)
    expect(standardRequest.signal).toBe(toAbortSignalSpy.mock.results[0]!.value)

    expect(toStandardMethodSpy).toBeCalledTimes(1)
    expect(toStandardMethodSpy).toBeCalledWith(fastifyReq.raw.method)
    expect(standardRequest.method).toBe(toStandardMethodSpy.mock.results[0]!.value)

    expect(toStandardUrlSpy).toBeCalledTimes(1)
    expect(toStandardUrlSpy).toBeCalledWith(fastifyReq.raw)
    expect(standardRequest.url).toBe(toStandardUrlSpy.mock.results[0]!.value)
  })

  it('fallback to standard body parser', async ({ onTestFinished }) => {
    let standardRequest: StandardLazyRequest
    let standardBody: any

    const fastify = Fastify()
    onTestFinished(() => fastify.close())

    // allow any content type
    fastify.addContentTypeParser('*', (request, payload, done) => {
      done(null, undefined)
    })

    fastify.all('/', async (req, reply) => {
      standardRequest = toStandardLazyRequest(req, reply)
      standardBody = await standardRequest.body()
    })

    await fastify.ready()
    await request(fastify.server).post('/').field('foo', 'bar')

    const expectedBody = new FormData()
    expectedBody.append('foo', 'bar')
    expect(standardBody).toEqual(expectedBody)
  })
})
