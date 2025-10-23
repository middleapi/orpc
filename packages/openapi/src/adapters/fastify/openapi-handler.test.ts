import { os } from '@orpc/server'
import Fastify from 'fastify'
import request from 'supertest'
import { OpenAPIHandler } from './openapi-handler'

describe('openAPIHandler', () => {
  it('works', async () => {
    const handler = new OpenAPIHandler(os.route({ method: 'GET', path: '/ping' }).handler(({ input }) => ({ output: input })))

    const fastify = Fastify()

    fastify.all('/*', async (req, reply) => {
      await handler.handle(req, reply, { prefix: '/prefix' })
    })
    await fastify.ready()
    const res = await request(fastify.server).get('/prefix/ping?input=hello')

    expect(res.text).toContain('hello')
    expect(res.status).toBe(200)
  })
})
