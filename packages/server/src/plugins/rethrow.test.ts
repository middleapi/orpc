import { ORPCError } from '@orpc/client'
import { RPCHandler } from '../adapters/fetch'
import { os } from '../builder'
import { experimental_RethrowHandlerPlugin as RethrowHandlerPlugin } from './rethrow'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rethrowHandlerPlugin', () => {
  it('should rethrow errors when filter returns true', async () => {
    class CustomError extends Error {
      constructor(message: string, public readonly code: number) {
        super(message)
        this.name = 'CustomError'
      }
    }

    const customError = new CustomError('Error with code', 42)

    const handler = new RPCHandler({
      ping: os.handler(() => {
        throw customError
      }),
    }, {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new RethrowHandlerPlugin({
          filter: () => true, // Always rethrow
        }),
      ],
    })

    await expect(
      handler.handle(new Request('http://localhost/ping', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })),
    ).rejects.toThrow(customError)
  })

  it('should not rethrow errors when filter returns false', async () => {
    const customError = new Error('Custom error that should not be rethrown')

    const handler = new RPCHandler({
      ping: os.handler(() => {
        throw customError
      }),
    }, {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new RethrowHandlerPlugin({
          filter: () => false, // Never rethrow
        }),
      ],
    })

    await expect(
      handler.handle(new Request('http://localhost/ping', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })),
    ).resolves.toEqual({ matched: true, response: expect.toSatisfy((response: Response) => response.status === 500) })
  })

  it('should rethrow non-ORPCError errors and handle ORPCError normally', async () => {
    const handler = new RPCHandler({
      throwCustom: os.handler(() => {
        throw new Error('Custom error')
      }),
      throwORPC: os.handler(() => {
        throw new ORPCError('BAD_REQUEST', { message: 'ORPC error' })
      }),
    }, {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new RethrowHandlerPlugin({
          filter: error => !(error instanceof ORPCError),
        }),
      ],
    })

    // Non-ORPCError should be rethrown
    await expect(
      handler.handle(new Request('http://localhost/throwCustom', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })),
    ).rejects.toThrow('Custom error')

    // ORPCError should be handled normally (not rethrown)
    await expect(
      handler.handle(new Request('http://localhost/throwORPC', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })),
    ).resolves.toEqual({ matched: true, response: expect.toSatisfy((response: Response) => response.status === 400) })
  })

  it('should pass error and options to filter function', async () => {
    const filter = vi.fn(() => false)
    const thrownError = new Error('Test error')

    const handler = new RPCHandler({
      ping: os.handler(() => {
        throw thrownError
      }),
    }, {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new RethrowHandlerPlugin({ filter }),
      ],
    })

    await handler.handle(new Request('http://localhost/ping', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(filter).toHaveBeenCalledTimes(1)
    expect(filter).toHaveBeenCalledWith(
      thrownError,
      expect.objectContaining({
        request: expect.objectContaining({
          method: 'POST',
        }),
        context: expect.any(Object),
      }),
    )
  })

  it('should work normally without errors being thrown', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    }, {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new RethrowHandlerPlugin({
          filter: () => true,
        }),
      ],
    })

    await expect(
      handler.handle(new Request('http://localhost/ping', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })),
    ).resolves.toEqual({
      matched: true,
      response: expect.toSatisfy((response: Response) => response.status === 200),
    })
  })

  it('should response error if other plugins or interceptors corrupt the context', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    }, {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new RethrowHandlerPlugin({
          filter: () => true,
        }),
        {
          init(options) {
            options.rootInterceptors?.push(async (options) => {
              // Corrupt the context
              return options.next({
                ...options,
                context: {},
              })
            })
          },
        },
      ],
    })

    await expect(
      handler.handle(new Request('http://localhost/ping', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })),
    ).resolves.toEqual({
      matched: true,
      response: expect.toSatisfy((response: Response) => response.status === 500),
    })
  })
})
