import type { Tracer } from '@orpc/shared'
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
    spanContext: vi.fn(() => ({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', traceFlags: 0 })),
    end: vi.fn(),
  }
}

function createFakeTracing(span = createFakeSpan()) {
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

  it('injects a sampled traceparent from the span context', () => {
    const tracer = new CloudflareTracer({ tracing: createFakeTracing() as any })
    const headers = { existing: 'value' }

    tracer.inject!(tracer.startSpan('name'), headers)

    expect(headers).toEqual({
      existing: 'value',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    })
  })

  it('injects nothing when the span context is invalid', () => {
    const fake = createFakeTracing()
    fake.span.spanContext.mockReturnValue({ traceId: '00000000000000000000000000000000', spanId: '0000000000000000', traceFlags: 0 })
    const tracer = new CloudflareTracer({ tracing: fake as any })
    const headers = {}

    tracer.inject!(tracer.startSpan('name'), headers)

    expect(headers).toEqual({})
  })

  it('has no inject method when propagation is disabled', () => {
    const tracer: Tracer = new CloudflareTracer({ tracing: createFakeTracing() as any, propagationEnabled: false })
    expect(tracer.inject).toBeUndefined()
  })

  it('has no extract method', () => {
    const tracer: Tracer = new CloudflareTracer({ tracing: createFakeTracing() as any })
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
  })

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
        span.updateName('renamed')
        span.recordException('info', { name: 'AbortError', message: 'aborted' })
        span.recordException('error', { name: 'TypeError', message: 'boom', code: 'CODE' })

        expect((tracer.getActiveSpan() as CloudflareSpan).span).toBe((span as CloudflareSpan).span)

        const detached = tracer.startSpan('detached')
        detached.end()

        expect(tracer.withActiveSpan(span, () => 'inner')).toBe('inner')

        span.end()
        return 'out'
      })

      expect(result).toBe('out')
      expect(tracer.getActiveSpan()).toBeUndefined()
    })

    it('injects nothing while the worker records no traces', async () => {
      const tracer = new CloudflareTracer()
      const headers = {}

      await tracer.startActiveSpan('active', undefined, async (span) => {
        tracer.inject!(span, headers)
        span.end()
      })

      expect(headers).toEqual({})
    })

    it('rethrows errors from active spans', async () => {
      const tracer = new CloudflareTracer()

      await expect(tracer.startActiveSpan('failing', undefined, async () => {
        throw new Error('boom')
      })).rejects.toThrow('boom')
    })
  })
})
