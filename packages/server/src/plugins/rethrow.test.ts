import { COMMON_ERROR_STATUSES, ORPCError } from '@orpc/client'
import { toArray } from '@orpc/shared'

import { RPCHandler } from '../adapters/fetch/index'
import { os } from '../builder'
import { RethrowHandlerPlugin } from './rethrow'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rethrowHandlerPlugin', () => {
  const procedure_handler = vi.fn()
  const procedure = os.handler(procedure_handler)

  const filter = vi.fn(() => false)
  const interceptor = vi.fn(({ next }) => next())
  const handler = new RPCHandler(procedure, {
    allowMethods: ['GET'], // tests below send GET requests
    interceptors: [interceptor],
    plugins: [
      new RethrowHandlerPlugin({
        filter,
      }),
    ],
  })

  it('preserves the success response when no error is thrown', async () => {
    const { response } = await handler.handle(new Request('http://localhost'))
    expect(response?.status).toBe(200)
  })

  it('rethrows handler errors when the filter returns true', async () => {
    const error = new Error('__TEST__')
    procedure_handler.mockRejectedValueOnce(error)
    filter.mockReturnValueOnce(true)

    await expect(
      handler.handle(new Request('http://localhost'), { context: { context: true } }),
    ).rejects.toBe(error)

    expect(filter).toHaveBeenCalledTimes(1)
    expect(filter).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ context: expect.objectContaining({ context: true }) }),
    )
  })

  it('rethrows interceptor errors when the filter returns true', async () => {
    const error = new Error('__TEST__')
    interceptor.mockRejectedValueOnce(error)
    filter.mockReturnValueOnce(true)

    await expect(
      handler.handle(new Request('http://localhost'), { context: { context: true } }),
    ).rejects.toBe(error)

    expect(filter).toHaveBeenCalledTimes(1)
    expect(filter).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ context: expect.objectContaining({ context: true }) }),
    )
  })

  it('does not rethrow when the filter returns false', async () => {
    const error = new ORPCError('NOT_ACCEPTABLE')
    procedure_handler.mockRejectedValueOnce(error)
    filter.mockReturnValueOnce(false)

    const { response } = await handler.handle(new Request('http://localhost'))
    expect(response?.status).toBe(COMMON_ERROR_STATUSES.NOT_ACCEPTABLE)
  })

  it('throws when another interceptor corrupts the plugin context', async () => {
    const interceptor = vi.fn(({ next, ...options }) => next({ ...options, context: {} }))
    const handler = new RPCHandler(procedure, {
      allowMethods: ['GET'],
      interceptors: [interceptor],
      plugins: [
        new RethrowHandlerPlugin({
          filter,
        }),
        {
          name: '~test',
          after: ['~rethrow'],
          init(options) {
            return {
              ...options,
              interceptors: [interceptor, ...toArray(options.interceptors)],
            }
          },
        },
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost'))
    expect(response?.status).toBe(500)

    expect(interceptor).toHaveBeenCalledTimes(1)
    await expect(interceptor.mock.results[0]?.value).rejects.toThrow(
      'context has been corrupted or modified',
    )
  })
})

describe('rethrowHandlerPlugin with malformed requests', () => {
  const procedure_handler = vi.fn()
  const filter = vi.fn((error: unknown) => !(error instanceof ORPCError))
  const handler = new RPCHandler(os.handler(procedure_handler), {
    allowMethods: ['GET', 'POST'],
    plugins: [new RethrowHandlerPlugin({ filter })],
  })

  const post = (body: string) =>
    new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

  it.each([
    ['body', post('{bad')],
    ['query', new Request('http://localhost?data=%7Bbad')],
  ])(
    'passes %s decode failures to the filter as BAD_REQUEST and does not rethrow them',
    async (_, request) => {
      const { response } = await handler.handle(request)

      expect(response?.status).toBe(400)
      expect(procedure_handler).not.toHaveBeenCalled()
      expect(filter).toHaveBeenCalledOnce()
      expect(filter.mock.calls[0]![0]).toSatisfy(
        (error) => error instanceof ORPCError && error.code === 'BAD_REQUEST',
      )
    },
  )

  it('still rethrows procedure errors', async () => {
    const error = new TypeError('__TEST__')
    procedure_handler.mockRejectedValueOnce(error)

    await expect(handler.handle(post('{}'))).rejects.toBe(error)
  })
})
