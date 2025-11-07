import { StandardHandler, StandardRPCMatcher } from '@orpc/server/standard'
import { describe, expect, it } from 'vitest'
import { RATELIMIT_HANDLER_CONTEXT_SYMBOL, RatelimitHandlerPlugin } from './handler-plugin'

describe('ratelimitHandlerPlugin', () => {
  const createMockRequest = (url: string) => ({
    method: 'GET',
    url: new URL(url),
    headers: {},
    signal: new AbortController().signal,
    body: () => Promise.resolve(''),
  })

  it('adds rate limit headers', async () => {
    const resetTime = Date.now() + 60000

    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      context[RATELIMIT_HANDLER_CONTEXT_SYMBOL].ratelimitResult = {
        limit: 100,
        remaining: 50,
        reset: resetTime,
      }

      return {
        matched: true as const,
        response: { status: 200, headers: {}, body: 'ok' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched)
      throw new Error('request should match')

    expect(result.response.headers['ratelimit-limit']).toBe('100')
    expect(result.response.headers['ratelimit-remaining']).toBe('50')
    expect(result.response.headers['ratelimit-reset']).toBe(resetTime.toString())
  })

  it('adds retry-after header on 429 status', async () => {
    const resetTime = Date.now() + 30000

    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      context[RATELIMIT_HANDLER_CONTEXT_SYMBOL].ratelimitResult = {
        success: false,
        reset: resetTime,
      }

      return {
        matched: true as const,
        response: { status: 429, headers: {}, body: 'too many requests' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched)
      throw new Error('request should match')

    const retryAfter = Number.parseInt(result.response.headers['retry-after'] as string)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(31)
  })

  it('does not add retry-after when success is true', async () => {
    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      context[RATELIMIT_HANDLER_CONTEXT_SYMBOL].ratelimitResult = {
        success: true,
        reset: Date.now() + 60000,
      }

      return {
        matched: true as const,
        response: { status: 429, headers: {}, body: 'ok' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched)
      throw new Error('request should match')

    expect(result.response.headers['retry-after']).toBeUndefined()
  })

  it('does not add retry-after when status is not 429', async () => {
    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      context[RATELIMIT_HANDLER_CONTEXT_SYMBOL].ratelimitResult = {
        success: false,
        reset: Date.now() + 60000,
      }

      return {
        matched: true as const,
        response: { status: 200, headers: {}, body: 'ok' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched)
      throw new Error('request should match')

    expect(result.response.headers['retry-after']).toBeUndefined()
  })

  it('clamps retry-after to 0 when reset is in the past', async () => {
    const resetTime = Date.now() - 5000 // 5 seconds ago

    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      context[RATELIMIT_HANDLER_CONTEXT_SYMBOL].ratelimitResult = {
        success: false,
        reset: resetTime,
      }

      return {
        matched: true as const,
        response: { status: 429, headers: {}, body: 'too many requests' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched) {
      throw new Error('request should match')
    }

    expect(result.response.headers['retry-after']).toBe('0')
  })

  it('does not add headers when ratelimitResult is undefined', async () => {
    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async () => ({
      matched: true as const,
      response: { status: 200, headers: {}, body: 'ok' },
    }))

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched)
      throw new Error('request should match')

    expect(result.response.headers['ratelimit-limit']).toBeUndefined()
    expect(result.response.headers['ratelimit-remaining']).toBeUndefined()
  })

  it('handles partial ratelimitResult', async () => {
    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      context[RATELIMIT_HANDLER_CONTEXT_SYMBOL].ratelimitResult = { limit: 100 }

      return {
        matched: true as const,
        response: { status: 200, headers: {}, body: 'ok' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    const result = await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    if (!result.matched)
      throw new Error('request should match')

    expect(result.response.headers['ratelimit-limit']).toBe('100')
    expect(result.response.headers['ratelimit-remaining']).toBeUndefined()
  })

  it('injects context with symbol', async () => {
    let capturedContext: any

    const options: any = { rootInterceptors: [] }
    new RatelimitHandlerPlugin().init(options)

    options.rootInterceptors.push(async ({ context }: any) => {
      capturedContext = context
      return {
        matched: true as const,
        response: { status: 200, headers: {}, body: 'ok' },
      }
    })

    const handler = new StandardHandler({}, new StandardRPCMatcher(), {} as any, options)
    await handler.handle(createMockRequest('https://example.com/ping'), { context: {} })

    expect(capturedContext[RATELIMIT_HANDLER_CONTEXT_SYMBOL]).toBeDefined()
  })
})
