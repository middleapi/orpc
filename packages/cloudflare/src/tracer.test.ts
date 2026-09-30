import type { Tracer } from '@orpc/shared'
import { ORPCError, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { getTracer, setTracer } from '@orpc/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_CloudflareSpan as CloudflareSpan, experimental_CloudflareTracer as CloudflareTracer } from './tracer'

function createFakeSpan() {
  return {
    isTraced: true,
    setAttribute: vi.fn().mockReturnThis(),
    setAttributes: vi.fn().mockReturnThis(),
    recordException: vi.fn(),
    updateName: vi.fn().mockReturnThis(),
    setStatus: vi.fn().mockReturnThis(),
    end: vi.fn(),
  }
}

/**
 * Mirrors runtimes before workerd 1.20260925.1, which have the rest of the tracing api
 */
function createFakeSpanWithoutRenameAndStatus() {
  const { updateName: _updateName, setStatus: _setStatus, ...span } = createFakeSpan()
  return span
}

function createFakeTracing(span: ReturnType<typeof createFakeSpanWithoutRenameAndStatus> = createFakeSpan()) {
  return {
    span,
    enterSpan: vi.fn(),
    startActiveSpan: vi.fn((_name: string, callback: (span: any) => unknown) => callback(span)),
    startSpan: vi.fn(() => span),
    getActiveSpan: vi.fn(() => span),
  }
}

describe('cloudflareTracer', () => {
  afterEach(() => {
    setTracer(undefined)
  })

  it('enables and disables itself as the oRPC tracer', () => {
    const tracer = new CloudflareTracer({ tracing: createFakeTracing() as any })

    tracer.enable()
    expect(getTracer()).toBe(tracer)

    tracer.disable()
    expect(getTracer()).toBeUndefined()
  })

  it('starts active spans with the manually ended startActiveSpan', async () => {
    const fake = createFakeTracing()
    const tracer = new CloudflareTracer({ tracing: fake as any })

    const result = await tracer.startActiveSpan('name', undefined, async (span) => {
      expect(span).toBeInstanceOf(CloudflareSpan)
      expect((span as CloudflareSpan).span).toBe(fake.span)
      return 'out'
    })

    expect(result).toBe('out')
    expect(fake.startActiveSpan).toHaveBeenCalledWith('name', expect.any(Function))
    expect(fake.enterSpan).not.toHaveBeenCalled()
    expect(fake.span.end).not.toHaveBeenCalled()
  })

  it('starts detached spans with startSpan', () => {
    const fake = createFakeTracing()
    const tracer = new CloudflareTracer({ tracing: fake as any })

    const span = tracer.startSpan('name') as CloudflareSpan
    expect(span.span).toBe(fake.span)
    expect(fake.startSpan).toHaveBeenCalledWith('name')

    span.end()
    expect(fake.span.end).toHaveBeenCalledTimes(1)
  })

  it('returns the active span', () => {
    const fake = createFakeTracing()
    const tracer = new CloudflareTracer({ tracing: fake as any })

    expect((tracer.getActiveSpan() as CloudflareSpan).span).toBe(fake.span)

    fake.getActiveSpan.mockReturnValue(undefined as any)
    expect(tracer.getActiveSpan()).toBeUndefined()
  })

  it('runs the callback directly for withActiveSpan', async () => {
    const tracer = new CloudflareTracer({ tracing: createFakeTracing() as any })
    const span = tracer.startSpan('name')

    expect(tracer.withActiveSpan(span, () => 'out')).toBe('out')
  })

  it('has no propagation methods', () => {
    const tracer: Tracer = new CloudflareTracer({ tracing: createFakeTracing() as any })
    expect(tracer.inject).toBeUndefined()
    expect(tracer.extract).toBeUndefined()
  })

  describe('span', () => {
    it('sets primitive attributes as is and serializes arrays', () => {
      const fake = createFakeSpan()
      const span = new CloudflareSpan(fake as any)

      span.setAttribute('string', 'value')
      span.setAttribute('number', 1)
      span.setAttribute('boolean', true)
      span.setAttribute('array', ['a', 'b'])

      expect(fake.setAttribute).toHaveBeenNthCalledWith(1, 'string', 'value')
      expect(fake.setAttribute).toHaveBeenNthCalledWith(2, 'number', 1)
      expect(fake.setAttribute).toHaveBeenNthCalledWith(3, 'boolean', true)
      expect(fake.setAttribute).toHaveBeenNthCalledWith(4, 'array', '["a","b"]')
    })

    it('renames spans', () => {
      const fake = createFakeSpan()
      const span = new CloudflareSpan(fake as any)

      span.updateName('renamed')

      expect(fake.updateName).toHaveBeenCalledWith('renamed')
    })

    it('ignores events', () => {
      const fake = createFakeSpan()
      const span = new CloudflareSpan(fake as any)

      span.addEvent('event')

      expect(fake.setAttribute).not.toHaveBeenCalled()
      expect(fake.end).not.toHaveBeenCalled()
    })

    it('records error level exceptions natively and marks the span as failed', () => {
      const fake = createFakeSpan()
      const span = new CloudflareSpan(fake as any)
      const exception = { name: 'TypeError', message: 'boom', stack: 'stack', code: 'CODE' }

      span.recordException('error', exception)

      expect(fake.recordException).toHaveBeenCalledWith(exception)
      expect(fake.setStatus).toHaveBeenCalledWith({ code: 'error', message: 'boom' })
    })

    it('records info level exceptions natively without marking the span as failed', () => {
      const fake = createFakeSpan()
      const span = new CloudflareSpan(fake as any)
      const exception = { name: 'AbortError', message: 'aborted', stack: 'stack' }

      span.recordException('info', exception)

      expect(fake.recordException).toHaveBeenCalledWith(exception)
      expect(fake.setStatus).not.toHaveBeenCalled()
    })

    it('skips renames and statuses on runtimes without them', () => {
      const fake = createFakeSpanWithoutRenameAndStatus()
      const span = new CloudflareSpan(fake as any)
      const exception = { name: 'TypeError', message: 'boom' }

      expect(() => span.updateName('renamed')).not.toThrow()
      expect(() => span.recordException('error', exception)).not.toThrow()

      expect(fake.recordException).toHaveBeenCalledWith(exception)
    })
  })

  describe('on runtimes without updateName and setStatus', () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
      fail: os.handler(() => {
        throw new ORPCError('NOT_FOUND', { message: 'missing' })
      }),
    })

    function setup() {
      const fake = createFakeTracing(createFakeSpanWithoutRenameAndStatus())
      new CloudflareTracer({ tracing: fake as any }).enable()
      return fake
    }

    function request(path: string, body: string = JSON.stringify({ json: null })) {
      return handler.handle(new Request(`https://example.com/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }))
    }

    it('handles requests', async () => {
      const fake = setup()

      const { matched, response } = await request('ping')

      expect(matched).toBe(true)
      expect(response!.status).toBe(200)
      await expect(response!.json()).resolves.toEqual({ json: 'pong' })
      expect(fake.span.recordException).not.toHaveBeenCalled()
    })

    it('records procedure errors and keeps the original error', async () => {
      const fake = setup()

      const { matched, response } = await request('fail')

      expect(matched).toBe(true)
      expect(response!.status).toBe(404)
      await expect(response!.json()).resolves.toMatchObject({ json: { code: 'NOT_FOUND', message: 'missing' } })
      expect(fake.span.recordException).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND', message: 'missing' }))
    })

    it('records protocol errors and keeps the original error', async () => {
      const fake = setup()

      const { matched, response } = await request('ping', '{invalid')

      expect(matched).toBe(true)
      expect(response!.status).toBe(400)
      await expect(response!.json()).resolves.toMatchObject({ json: { code: 'BAD_REQUEST' } })
      // once by the decode_input span and once by the request span, which share the fake span
      expect(fake.span.recordException).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * The vitest workers pool still bundles a workerd without getActiveSpan, recordException,
   * updateName, and setStatus, so only the older methods run against the real runtime here.
   */
  describe('with the runtime tracing api', () => {
    it('defaults to the tracing export of cloudflare:workers', () => {
      const tracer = new CloudflareTracer()

      tracer.enable()
      expect(getTracer()).toBe(tracer)
    })

    it('records spans without throwing', async () => {
      const tracer = new CloudflareTracer()

      const result = await tracer.startActiveSpan('active', undefined, async (span) => {
        span.setAttribute('key', 'value')
        span.setAttribute('path', ['a', 'b'])
        span.addEvent('event')

        const detached = tracer.startSpan('detached')
        detached.end()

        expect(tracer.withActiveSpan(span, () => 'inner')).toBe('inner')

        span.end()
        return 'out'
      })

      expect(result).toBe('out')
    })

    it('rethrows errors from active spans', async () => {
      const tracer = new CloudflareTracer()

      await expect(tracer.startActiveSpan('failing', undefined, async () => {
        throw new Error('boom')
      })).rejects.toThrow('boom')
    })
  })
})
