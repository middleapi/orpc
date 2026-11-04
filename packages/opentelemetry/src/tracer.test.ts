import type { TracingHeaders } from '@orpc/shared'
import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { OpenTelemetrySpan, OpenTelemetryTracer } from './tracer'

const exporter = new InMemorySpanExporter()
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})

/**
 * Registers the global tracer provider, the AsyncLocalStorage context manager
 * and the W3C trace context + baggage propagators.
 */
provider.register()

beforeEach(() => {
  exporter.reset()
})

afterAll(async () => {
  await provider.shutdown()
  trace.disable()
  context.disable()
  propagation.disable()
})

function createTracer(options: { propagationEnabled?: boolean } = {}) {
  return new OpenTelemetryTracer({ tracer: () => trace.getTracer('test'), ...options })
}

function activeBaggageUser() {
  return propagation.getActiveBaggage()?.getEntry('user')?.value
}

function finishedSpan(name: string) {
  const span = exporter.getFinishedSpans().find(span => span.name === name)
  expect(span).toBeDefined()
  return span!
}

describe('openTelemetryTracer', () => {
  it('starts an active span and passes it to the callback', async () => {
    const tracer = createTracer()

    const result = await tracer.startActiveSpan('active', undefined, async (span) => {
      expect(span).toBeInstanceOf(OpenTelemetrySpan)
      expect(trace.getActiveSpan()).toBe((span as OpenTelemetrySpan).span)

      span.setAttribute('key', 'value')
      span.setAttribute('list', ['a', 'b'])
      span.addEvent('event')
      span.updateName('renamed')
      span.end()

      return 'out'
    })

    expect(result).toBe('out')
    expect(trace.getActiveSpan()).toBeUndefined()

    const span = finishedSpan('renamed')
    expect(span.attributes).toEqual({ key: 'value', list: ['a', 'b'] })
    expect(span.events.map(event => event.name)).toEqual(['event'])
  })

  it('parents active spans on the parent option', async () => {
    const tracer = createTracer()
    const parent = tracer.startSpan('parent') as OpenTelemetrySpan

    await tracer.startActiveSpan('child', parent, async (child) => {
      expect(trace.getActiveSpan()).toBe((child as OpenTelemetrySpan).span)
      child.end()
    })

    parent.end()

    expect(finishedSpan('child').parentSpanContext?.spanId).toBe(parent.span.spanContext().spanId)
  })

  it('starts spans under the active span without activating them', async () => {
    const tracer = createTracer()

    await tracer.startActiveSpan('outer', undefined, async (outer) => {
      const inner = tracer.startSpan('inner')
      expect(trace.getActiveSpan()).toBe((outer as OpenTelemetrySpan).span)
      inner.end()

      const explicit = tracer.startSpan('explicit', inner)
      explicit.end()

      outer.end()
    })

    const outer = finishedSpan('outer')
    const inner = finishedSpan('inner')
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId)
    expect(finishedSpan('explicit').parentSpanContext?.spanId).toBe(inner.spanContext().spanId)
  })

  it('returns the active span', async () => {
    const tracer = createTracer()

    expect(tracer.getActiveSpan()).toBeUndefined()

    await tracer.startActiveSpan('active', undefined, async (span) => {
      const active = tracer.getActiveSpan() as OpenTelemetrySpan
      expect(active).toBeInstanceOf(OpenTelemetrySpan)
      expect(active.span).toBe((span as OpenTelemetrySpan).span)
      span.end()
    })
  })

  it('runs the callback with the given span as active span', async () => {
    const tracer = createTracer()
    const span = tracer.startSpan('span') as OpenTelemetrySpan

    const result = await tracer.withActiveSpan(span, async () => {
      expect(trace.getActiveSpan()).toBe(span.span)
      return 'out'
    })

    expect(result).toBe('out')
    expect(trace.getActiveSpan()).toBeUndefined()
    span.end()
  })

  it('records exceptions and marks failed spans', async () => {
    const tracer = createTracer()

    const failed = tracer.startSpan('failed')
    failed.recordException('error', { name: 'Error', message: 'boom', stack: 'stack', code: 'CODE' })
    failed.end()

    const aborted = tracer.startSpan('aborted')
    aborted.recordException('info', { name: 'AbortError', message: 'aborted' })
    aborted.end()

    const failedSpan = finishedSpan('failed')
    expect(failedSpan.status).toEqual({ code: SpanStatusCode.ERROR, message: 'boom' })
    expect(failedSpan.events[0]?.name).toBe('exception')
    expect(failedSpan.events[0]?.attributes).toMatchObject({
      'exception.type': 'CODE',
      'exception.message': 'boom',
      'exception.stacktrace': 'stack',
    })

    const abortedSpan = finishedSpan('aborted')
    expect(abortedSpan.status).toEqual({ code: SpanStatusCode.UNSET })
    expect(abortedSpan.events[0]?.name).toBe('exception')
  })

  it('injects the trace context of a span into headers', () => {
    const tracer = createTracer()
    const span = tracer.startSpan('span') as OpenTelemetrySpan
    const headers: TracingHeaders = { existing: 'header' }

    tracer.inject!(span, headers)
    span.end()

    const { traceId, spanId } = span.span.spanContext()
    expect(headers).toEqual({ existing: 'header', traceparent: `00-${traceId}-${spanId}-01` })
  })

  it('extracts the remote parent from headers', async () => {
    const tracer = createTracer()
    const headers = {
      traceparent: '00-4bf92f3577b34da6a2ce929d0e0e4736-00f067aa0ba902b7-01',
    }

    const parent = tracer.extract!(headers)
    expect(parent).toBeInstanceOf(OpenTelemetrySpan)

    await tracer.startActiveSpan('child', parent, async (child) => {
      child.end()
    })

    const child = finishedSpan('child')
    expect(child.spanContext().traceId).toBe('4bf92f3577b34da6a2ce929d0e0e4736')
    expect(child.parentSpanContext?.spanId).toBe('00f067aa0ba902b7')
  })

  it('keeps the baggage of the extracted context visible in the handler and re-injects it', async () => {
    const tracer = createTracer()
    const parent = tracer.extract!({
      traceparent: '00-4bf92f3577b34da6a2ce929d0e0e4736-00f067aa0ba902b7-01',
      baggage: 'user=alice',
    })

    const headers: TracingHeaders = {}

    await tracer.startActiveSpan('handler', parent, async (span) => {
      expect(activeBaggageUser()).toBe('alice')

      const client = tracer.startSpan('client')
      tracer.inject!(client, headers)
      client.end()

      span.end()
    })

    const client = finishedSpan('client')
    expect(headers).toEqual({
      traceparent: `00-4bf92f3577b34da6a2ce929d0e0e4736-${client.spanContext().spanId}-01`,
      baggage: 'user=alice',
    })
    expect(finishedSpan('handler').parentSpanContext?.spanId).toBe('00f067aa0ba902b7')
  })

  it('keeps baggage of headers without trace context and starts a new trace', async () => {
    const tracer = createTracer()
    const parent = tracer.extract!({ baggage: 'user=alice' })

    const headers: TracingHeaders = {}

    await tracer.startActiveSpan('handler', parent, async (span) => {
      expect(activeBaggageUser()).toBe('alice')
      tracer.inject!(span, headers)
      span.end()
    })

    expect(trace.getSpan((parent as OpenTelemetrySpan).context)).toBeUndefined()

    const handler = finishedSpan('handler')
    expect(handler.parentSpanContext).toBeUndefined()
    expect(headers).toEqual({
      traceparent: `00-${handler.spanContext().traceId}-${handler.spanContext().spanId}-01`,
      baggage: 'user=alice',
    })
  })

  it('keeps the baggage of a span activated after its scope ended, e.g. while a stream is consumed', async () => {
    const tracer = createTracer()
    const parent = tracer.extract!({ baggage: 'user=alice' })

    // Like the server handler: the span outlives `startActiveSpan` and is re-activated per stream pull
    const handler = await tracer.startActiveSpan('handler', parent, async span => span)

    expect(propagation.getActiveBaggage()).toBeUndefined()

    const headers: TracingHeaders = {}

    await tracer.withActiveSpan(handler, async () => {
      expect(activeBaggageUser()).toBe('alice')
      expect(trace.getActiveSpan()).toBe((handler as OpenTelemetrySpan).span)

      const child = tracer.startSpan('child')
      tracer.inject!(child, headers)

      await tracer.withActiveSpan(child, () => {
        expect(activeBaggageUser()).toBe('alice')
      })

      child.end()
    })

    handler.end()

    expect(finishedSpan('child').parentSpanContext?.spanId).toBe(finishedSpan('handler').spanContext().spanId)
    expect(headers.baggage).toBe('user=alice')
  })

  it('keeps the baggage of an explicit parent for spans used outside its scope', async () => {
    const tracer = createTracer()
    const child = tracer.startSpan('child', tracer.extract!({ baggage: 'user=alice' }))
    const headers: TracingHeaders = {}

    tracer.inject!(child, headers)
    await tracer.withActiveSpan(child, () => {
      expect(activeBaggageUser()).toBe('alice')
    })
    child.end()

    expect(headers.baggage).toBe('user=alice')
  })

  it('uses the active span as parent for baggage-only headers', async () => {
    const tracer = createTracer()

    await tracer.startActiveSpan('http', undefined, async (http) => {
      const parent = tracer.extract!({ baggage: 'user=alice' }) as OpenTelemetrySpan
      expect(parent.span).toBe((http as OpenTelemetrySpan).span)

      await tracer.startActiveSpan('handler', parent, async (span) => {
        expect(activeBaggageUser()).toBe('alice')
        span.end()
      })

      http.end()
    })

    expect(finishedSpan('handler').parentSpanContext?.spanId).toBe(finishedSpan('http').spanContext().spanId)
  })

  it('injects the baggage of the context the active span was read in', async () => {
    const tracer = createTracer()
    const headers: TracingHeaders = {}
    const baggage = propagation.createBaggage({ user: { value: 'alice' } })

    await tracer.startActiveSpan('active', undefined, async (span) => {
      await context.with(propagation.setBaggage(context.active(), baggage), async () => {
        tracer.inject!(tracer.getActiveSpan()!, headers)
      })
      span.end()
    })

    expect(headers.baggage).toBe('user=alice')
  })

  it('keeps baggage already in the active context when extracting, and lets it win on conflict', async () => {
    const tracer = createTracer()
    const baggage = propagation.createBaggage({ tenant: { value: 't1' }, user: { value: 'server' } })

    const parent = context.with(propagation.setBaggage(context.active(), baggage), () =>
      tracer.extract!({ baggage: 'user=alice,region=eu' }))

    await tracer.withActiveSpan(parent!, () => {
      const entries = Object.fromEntries(propagation.getActiveBaggage()!.getAllEntries().map(([key, entry]) => [key, entry.value]))
      expect(entries).toEqual({ tenant: 't1', user: 'server', region: 'eu' })
    })
  })

  it('falls back to the active context for spans of another tracer', async () => {
    const tracer = createTracer()
    const foreign = { setAttribute() {}, updateName() {}, addEvent() {}, recordException() {}, end() {} }
    const headers: TracingHeaders = {}

    await tracer.startActiveSpan('outer', undefined, async (outer) => {
      tracer.startSpan('child', foreign).end()
      tracer.inject!(foreign, headers)
      expect(await tracer.withActiveSpan(foreign, () => 'out')).toBe('out')
      outer.end()
    })

    const outer = finishedSpan('outer')
    expect(finishedSpan('child').parentSpanContext?.spanId).toBe(outer.spanContext().spanId)
    expect(headers.traceparent).toBe(`00-${outer.spanContext().traceId}-${outer.spanContext().spanId}-01`)
  })

  it('falls back to the active span when headers carry no trace context', async () => {
    const tracer = createTracer()

    expect(tracer.extract!({})).toBeUndefined()

    await tracer.startActiveSpan('outer', undefined, async (outer) => {
      expect((tracer.extract!({}) as OpenTelemetrySpan).span).toBe((outer as OpenTelemetrySpan).span)
      outer.end()
    })
  })

  it('has no propagation methods when propagation is disabled', () => {
    const tracer = createTracer({ propagationEnabled: false })
    expect(tracer.inject).toBeUndefined()
    expect(tracer.extract).toBeUndefined()
  })
})
