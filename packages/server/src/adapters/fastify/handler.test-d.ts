import type { FastifyReply, FastifyRequest } from '@orpc/standard-server-fastify'
import type { FastifyHandler } from './handler'

describe('FastifyHandler', () => {
  it('optional context when all context is optional', () => {
    const handler = {} as FastifyHandler<{ auth?: boolean }>

    handler.handle({} as FastifyRequest, {} as FastifyReply)
    handler.handle({} as FastifyRequest, {} as FastifyReply, { context: { auth: true } })

    const handler2 = {} as FastifyHandler<{ auth: boolean }>

    handler2.handle({} as FastifyRequest, {} as FastifyReply, { context: { auth: true } })
    // @ts-expect-error -- context is required
    handler2.handle({} as FastifyRequest, {} as FastifyReply)
  })
})
