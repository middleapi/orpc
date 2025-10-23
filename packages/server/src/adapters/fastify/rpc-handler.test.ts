import Fastify from 'fastify'
import request from 'supertest'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

describe('rpcHandler', () => {
  const handler = new RPCHandler({
    ping: os.route({ method: 'GET' }).handler(({ input }) => ({ output: input })),
    pong: os.handler(({ input }) => ({ output: input })),
  })

  it('works', async () => {
    const fastify = Fastify()

    fastify.all('/*', async (req, reply) => {
      await handler.handle(req, reply, { prefix: '/prefix' })
    })

    await fastify.ready()
    const res = await request(fastify.server).get('/prefix/ping?data=%7B%22json%22%3A%22value%22%7D')

    expect(res.text).toContain('value')
    expect(res.status).toBe(200)
  })

  it('enable StrictGetMethodPlugin by default', async () => {
    const fastify = Fastify()

    fastify.all('/*', async (req, reply) => {
      await handler.handle(req, reply)
    })

    await fastify.ready()
    const res = await request(fastify.server).get('/pong?data=%7B%22json%22%3A%22value%22%7D')

    expect(res!.status).toEqual(405)
  })
})
