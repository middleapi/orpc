import { sendStandardResponse, toStandardLazyRequest } from '@orpc/standard-server-fastify'
import Fastify from 'fastify'
import request from 'supertest'
import { FastifyHandler } from './handler'

vi.mock('@orpc/standard-server-fastify', () => ({
  toStandardLazyRequest: vi.fn(),
  sendStandardResponse: vi.fn(),
}))

vi.mock('../standard', async origin => ({
  ...await origin(),
  StandardHandler: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fastifyHandler', async () => {
  const handle = vi.fn()
  const interceptor = vi.fn(({ next }) => next())

  const handlerOptions = { eventIteratorKeepAliveComment: '__test__', adapterInterceptors: [interceptor] }

  const handler = new FastifyHandler({
    handle,
  } as any, handlerOptions)

  let req: any, reply: any
  const fastify = Fastify()

  fastify.get('/api/v1', (_req, _reply) => {
    req = _req
    reply = _reply

    return 'body'
  })

  await fastify.ready()
  await request(fastify.server).get('/api/v1')

  const standardRequest = {
    method: 'POST',
    url: new URL('https://example.com/api/v1/users/1'),
    headers: {
      'content-type': 'application/json',
      'content-length': '12',
    },
    body: () => Promise.resolve(JSON.stringify({ name: 'John Doe' })),
    signal: undefined,
  }

  it('on match', async () => {
    vi.mocked(toStandardLazyRequest).mockReturnValueOnce(standardRequest)
    handle.mockReturnValueOnce({
      matched: true,
      response: {
        status: 200,
        headers: {},
        body: '__body__',
      },
    })
    const options = { prefix: '/api/v1', context: { db: 'postgres' } } as const

    const result = await handler.handle(req, reply, options)

    expect(result).toEqual({
      matched: true,
    })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith(
      standardRequest,
      { prefix: '/api/v1', context: { db: 'postgres' } },
    )

    expect(toStandardLazyRequest).toHaveBeenCalledOnce()
    expect(toStandardLazyRequest).toHaveBeenCalledWith(req, reply)

    expect(sendStandardResponse).toHaveBeenCalledOnce()
    expect(sendStandardResponse).toHaveBeenCalledWith(reply, {
      status: 200,
      headers: {},
      body: '__body__',
    }, handlerOptions)

    expect(interceptor).toHaveBeenCalledOnce()
    expect(interceptor).toHaveBeenCalledWith({
      request: req,
      reply,
      sendStandardResponseOptions: handlerOptions,
      ...options,
      next: expect.any(Function),
    })
    expect(await interceptor.mock.results[0]!.value).toEqual({
      matched: true,
    })
  })

  it('on mismatch', async () => {
    vi.mocked(toStandardLazyRequest).mockReturnValueOnce(standardRequest)
    handle.mockReturnValueOnce({ matched: false })

    const options = { prefix: '/api/v1', context: { db: 'postgres' } } as const
    const result = await handler.handle(req, reply, options)

    expect(result).toEqual({ matched: false })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith(
      standardRequest,
      options,
    )

    expect(toStandardLazyRequest).toHaveBeenCalledOnce()
    expect(toStandardLazyRequest).toHaveBeenCalledWith(req, reply)

    expect(sendStandardResponse).not.toHaveBeenCalled()

    expect(interceptor).toHaveBeenCalledOnce()
    expect(interceptor).toHaveBeenCalledWith({
      request: req,
      reply,
      sendStandardResponseOptions: handlerOptions,
      ...options,
      next: expect.any(Function),
    })
    expect(await interceptor.mock.results[0]!.value).toEqual({
      matched: false,
    })
  })
})
