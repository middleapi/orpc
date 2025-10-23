import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendStandardResponse, toStandardLazyRequest } from '@orpc/standard-server-node'
import request from 'supertest'
import { NodeHttpHandler } from './handler'

vi.mock('@orpc/standard-server-node', () => ({
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

describe('nodeHttpHandlerOptions', async () => {
  const handle = vi.fn()
  const interceptor = vi.fn(({ next }) => next())

  const handlerOptions = { eventIteratorKeepAliveComment: '__test__', adapterInterceptors: [interceptor] }

  const handler = new NodeHttpHandler({
    handle,
  } as any, handlerOptions)

  let req: any, res: any

  await request(async (_req: IncomingMessage, _res: ServerResponse) => {
    req = _req
    res = _res

    res.end()
  }).get('/api/v1')

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

    const result = await handler.handle(req, res, options)

    expect(result).toEqual({
      matched: true,
    })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith(
      standardRequest,
      { prefix: '/api/v1', context: { db: 'postgres' } },
    )

    expect(toStandardLazyRequest).toHaveBeenCalledOnce()
    expect(toStandardLazyRequest).toHaveBeenCalledWith(req, res)

    expect(sendStandardResponse).toHaveBeenCalledOnce()
    expect(sendStandardResponse).toHaveBeenCalledWith(res, {
      status: 200,
      headers: {},
      body: '__body__',
    }, handlerOptions)

    expect(interceptor).toHaveBeenCalledOnce()
    expect(interceptor).toHaveBeenCalledWith({
      request: req,
      response: res,
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
    const result = await handler.handle(req, res, options)

    expect(result).toEqual({ matched: false })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith(
      standardRequest,
      options,
    )

    expect(toStandardLazyRequest).toHaveBeenCalledOnce()
    expect(toStandardLazyRequest).toHaveBeenCalledWith(req, res)

    expect(sendStandardResponse).not.toHaveBeenCalled()

    expect(interceptor).toHaveBeenCalledOnce()
    expect(interceptor).toHaveBeenCalledWith({
      request: req,
      response: res,
      sendStandardResponseOptions: handlerOptions,
      ...options,
      next: expect.any(Function),
    })
    expect(await interceptor.mock.results[0]!.value).toEqual({
      matched: false,
    })
  })

  it('plugins', () => {
    const initRuntimeAdapter = vi.fn()

    const handler = new NodeHttpHandler({
      handle,
    } as any, {
      plugins: [
        { initRuntimeAdapter },
      ],
      eventIteratorKeepAliveComment: '__test__',
    })

    expect(initRuntimeAdapter).toHaveBeenCalledOnce()
    expect(initRuntimeAdapter).toHaveBeenCalledWith({
      plugins: [
        { initRuntimeAdapter },
      ],
      eventIteratorKeepAliveComment: '__test__',
    })
  })
})
