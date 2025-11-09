import type { StandardLazyRequest } from '@orpc/standard-server'
import { StandardRPCJsonSerializer, StandardRPCSerializer } from '@orpc/client/standard'
import { os } from '@orpc/server'
import { StandardHandler, StandardRPCCodec, StandardRPCMatcher } from '@orpc/server/standard'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_LOGGER_SYMBOL, getLogger } from './context'
import { LoggingHandlerPlugin } from './handler-plugin'

// Global spy trackers shared across all FakeLogger instances
const globalSpies = {
  child: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  setBindings: vi.fn(),
}

// Minimal fake logger implementing required pino Logger interface pieces
class FakeLogger {
  private _bindings: any

  constructor(initial: any = {}, private childDeep: number = 0) {
    this._bindings = initial
  }

  child(opts: any) {
    globalSpies.child(opts)
    return new FakeLogger({ ...this._bindings, ...opts }, this.childDeep + 1)
  }

  info(...args: any[]) {
    expect(this.childDeep).toBeGreaterThan(0) // Ensure child logger is used
    globalSpies.info(...args)
  }

  error(...args: any[]) {
    expect(this.childDeep).toBeGreaterThan(0) // Ensure child logger is used
    globalSpies.error(...args)
  }

  setBindings(bindings: any) {
    expect(this.childDeep).toBeGreaterThan(0) // Ensure child logger is used
    globalSpies.setBindings(bindings)
    this._bindings = { ...this._bindings, ...bindings }
  }

  bindings() {
    return this._bindings
  }
}

function createRequest(method: string, url: string, signal?: AbortSignal): StandardLazyRequest {
  return {
    method,
    url: new URL(url),
    headers: {
      'content-type': 'application/json',
    },
    body: () => Promise.resolve(undefined),
    signal,
  }
}

describe('loggingHandlerPlugin', () => {
  const codec = new StandardRPCCodec(new StandardRPCSerializer(new StandardRPCJsonSerializer()))

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs request response for matched and unmatched requests', async () => {
    const baseLogger = new FakeLogger({ orpc: {} })
    const handler = new StandardHandler(
      {
        ping: os.handler(() => {
          // make sure request/response always log event on error.
          throw new Error('boom')
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any, logRequestResponse: true })],
      },
    )

    // matched request
    const request1 = createRequest('GET', 'http://localhost/ping')
    await handler.handle(request1, { prefix: undefined, context: {} })
    expect(globalSpies.info).toHaveBeenNthCalledWith(1, 'request received')
    expect(globalSpies.info).toHaveBeenNthCalledWith(2, {
      msg: 'request handled',
      res: {
        status: 500,
      },
    })

    // unmatched request
    vi.clearAllMocks()
    const request2 = createRequest('GET', 'http://localhost/notfound')
    await handler.handle(request2, { prefix: undefined, context: {} })
    expect(globalSpies.info).toHaveBeenCalledWith('request received')
    expect(globalSpies.info).toHaveBeenCalledWith('no matching procedure found')
  })

  it('logs abort event with reason', async () => {
    const baseLogger = new FakeLogger({ orpc: {} })
    const controller = new AbortController()
    const handler = new StandardHandler(
      {
        ping: os.handler(async () => {
          await new Promise(resolve => setTimeout(resolve, 100))
          return 'pong'
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any, logRequestAbort: true })],
      },
    )

    const request = createRequest('GET', 'http://localhost/ping', controller.signal)
    const promise = handler.handle(request, { prefix: undefined, context: {} })

    setTimeout(() => controller.abort('manual'), 10)
    await promise

    expect(globalSpies.info).toHaveBeenCalledWith('request is aborted (manual)')

    // if aborted before handling
    const request2 = createRequest('GET', 'http://localhost/ping', controller.signal)
    await handler.handle(request2, { prefix: undefined, context: {} })
    expect(globalSpies.info).toHaveBeenCalledWith('request was aborted before handling (manual)')
  })

  it('logs business error as error and abort error as info', async () => {
    const baseLogger = new FakeLogger({ orpc: {} })

    const error1 = new Error('boom')
    // business logic error
    const handler1 = new StandardHandler(
      {
        ping: os.handler(() => {
          throw error1
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any })],
      },
    )

    const request1 = createRequest('GET', 'http://localhost/ping')
    const result1 = await handler1.handle(request1, { prefix: undefined, context: {} })
    expect(result1.matched).toBe(true)
    expect(result1.response?.status).toBe(500)
    expect(globalSpies.error).toHaveBeenCalledWith(error1)

    // aborted error
    vi.clearAllMocks()
    const controller = new AbortController()
    const abortError = new Error('abort-reason')
    controller.abort(abortError)

    const handler2 = new StandardHandler(
      {
        ping: os.handler(() => {
          throw controller.signal.reason
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any })],
      },
    )

    const request2 = createRequest('GET', 'http://localhost/ping', controller.signal)
    const result2 = await handler2.handle(request2, { prefix: undefined, context: {} })
    expect(result2.matched).toBe(true)
    expect(globalSpies.info).toHaveBeenCalledWith(abortError)
  })

  it('logs internal errors', async () => {
    const error = new Error('internal-error')
    const baseLogger = new FakeLogger({ orpc: {} })
    const handler = new StandardHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any })],
        rootInterceptors: [
          async () => {
            throw error
          },
        ],
      },
    )

    const request = createRequest('GET', 'http://localhost/ping')
    // Root interceptor errors are thrown, not encoded in response
    await expect(handler.handle(request, { prefix: undefined, context: {} })).rejects.toThrow(error)
    expect(globalSpies.error).toHaveBeenCalledWith(error)
  })

  it('sets path on client interceptor and handles non-stream output', async () => {
    const baseLogger = new FakeLogger({ orpc: {} })
    let capturedLogger: any
    let capturedBeforeReturn: any

    const handler = new StandardHandler(
      {
        ping: os.handler(({ context }) => {
          capturedLogger = getLogger(context)
          capturedBeforeReturn = capturedLogger.bindings()
          return 'pong'
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any })],
      },
    )

    const request = createRequest('GET', 'http://localhost/ping')
    const result = await handler.handle(request, { prefix: undefined, context: {} })

    expect(result.matched).toBe(true)
    // The path should be set before the handler returns
    // because clientInterceptor wraps the procedure call
    expect(capturedBeforeReturn.orpc.path).toEqual(['ping'])
  })

  it('logs stream errors as error and abort stream errors as info', async () => {
    const baseLogger = new FakeLogger({ orpc: {} })

    const error = new Error('TEST')
    // stream error
    const handler1 = new StandardHandler(
      {
        ping: os.handler(async function* () {
          yield 1
          throw error
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any })],
      },
    )

    const request1 = createRequest('GET', 'http://localhost/ping')
    const result1 = await handler1.handle(request1, { prefix: undefined, context: {} })

    try {
      for await (const v of result1.response?.body as AsyncIterable<any>) {
        // consume only
      }
    }
    catch {}
    expect(globalSpies.info).toHaveBeenCalledTimes(0)
    expect(globalSpies.error).toHaveBeenCalledTimes(1)
    expect(globalSpies.error).toHaveBeenCalledWith(error)

    // aborted stream error
    vi.clearAllMocks()
    const controller = new AbortController()
    const abortedError = new Error('aborted-stream')
    controller.abort(abortedError)

    const handler2 = new StandardHandler(
      {
        ping: os.handler(async function* () {
          throw abortedError
        }),
      },
      new StandardRPCMatcher(),
      codec,
      {
        plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any })],
      },
    )

    const request2 = createRequest('GET', 'http://localhost/ping', controller.signal)
    const result2 = await handler2.handle(request2, { prefix: undefined, context: {} })

    try {
      for await (const _ of result2.response?.body as AsyncIterable<unknown>) {
        // noop
      }
    }
    catch {}
    // The logger should have been called with the original error or its wrapper
    expect(globalSpies.error).toHaveBeenCalledTimes(0)
    expect(globalSpies.info).toHaveBeenCalledTimes(1)
    expect(globalSpies.info).toHaveBeenCalledWith(abortedError)
  })

  describe('edge cases', () => {
    it('creates child logger with id and req when not provided in context', async () => {
      const baseLogger = new FakeLogger({ orpc: { existing: true } })
      const handler = new StandardHandler(
        {
          ping: os.handler(() => 'pong'),
        },
        new StandardRPCMatcher(),
        codec,
        {
          plugins: [new LoggingHandlerPlugin({ logger: baseLogger as any, generateId: () => 'test-id' })],
        },
      )

      const request = createRequest('POST', 'http://localhost/ping')
      await handler.handle(request, { prefix: undefined, context: {} })

      // Check that child logger was created
      expect(globalSpies.child).toHaveBeenCalled()
      expect(globalSpies.child).toHaveBeenCalledWith(
        expect.objectContaining({
          orpc: expect.objectContaining({ id: 'test-id' }),
        }),
      )

      // Verify id and req were set
      expect(globalSpies.setBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          req: {
            url: request.url,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
          },
        }),
      )
      expect(globalSpies.error).not.toHaveBeenCalled()
    })

    it('preserves existing req in context logger', async () => {
      const loggerWithReq = new FakeLogger({ orpc: {}, req: { url: 'original', method: 'POST' } })
      const handler = new StandardHandler(
        {
          ping: os.handler(() => 'pong'),
        },
        new StandardRPCMatcher(),
        codec,
        {
          plugins: [new LoggingHandlerPlugin({ logger: loggerWithReq as any, generateId: () => 'test-id' })],
        },
      )

      const request = createRequest('GET', 'http://localhost/ping')
      await handler.handle(request, { prefix: undefined, context: { [CONTEXT_LOGGER_SYMBOL]: loggerWithReq } })

      // Verify existing req was preserved - setBindings should not override existing req
      const setBindingsCalls = globalSpies.setBindings.mock.calls
      expect(setBindingsCalls.some(call => call[0]?.req !== undefined)).toBe(false)
    })

    it('uses default pino logger when no logger provided', () => {
      const plugin = new LoggingHandlerPlugin()
      // @ts-expect-error accessing private property for test
      expect(plugin.logger).toBeDefined()
    })
  })
})
