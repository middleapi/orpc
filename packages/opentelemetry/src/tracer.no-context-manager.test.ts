import type { TracingHeaders } from '@orpc/shared'
import { context, propagation, trace } from '@opentelemetry/api'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { OpenTelemetryTracer } from './tracer'

/**
 * Some setups (e.g. browsers or React Native without a context manager) cannot activate spans,
 * so oRPC passes parents explicitly. Explicit parents and inject must still work there.
 */
const exporter = new InMemorySpanExporter()
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })

beforeAll(() => {
  trace.disable()
  context.disable()
  propagation.disable()
  provider.register({ contextManager: null })
})

afterAll(async () => {
  await provider.shutdown()
  trace.disable()
  propagation.disable()
})

it('keeps explicit parents and injects trace context without a context manager', async () => {
  const tracer = new OpenTelemetryTracer({ tracer: () => trace.getTracer('test') })
  const headers: TracingHeaders = {}

  await tracer.startActiveSpan('parent', undefined, async (parent) => {
    expect(tracer.getActiveSpan()).toBeUndefined()

    tracer.startSpan('child', parent).end()
    tracer.inject!(parent, headers)
    parent.end()
  })

  const parent = exporter.getFinishedSpans().find(span => span.name === 'parent')!
  const child = exporter.getFinishedSpans().find(span => span.name === 'child')!

  expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
  expect(headers.traceparent).toBe(`00-${parent.spanContext().traceId}-${parent.spanContext().spanId}-01`)
})
