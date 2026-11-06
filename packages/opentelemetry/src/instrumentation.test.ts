import { trace } from '@opentelemetry/api'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { getTracer, setTracer } from '@orpc/shared'

import pkg from '../package.json' with { type: 'json' }
import { ORPCInstrumentation } from './instrumentation.ts'
import { OpenTelemetryTracer } from './tracer.ts'

const getTracerSpy = vi.spyOn(trace, 'getTracer')

beforeEach(() => {
  vi.clearAllMocks()
  setTracer(undefined)
})

describe('oRPCInstrumentation', () => {
  it('should initialize the instrumentation and enable by default', () => {
    const instrumentation = new ORPCInstrumentation()

    expect(getTracerSpy).toHaveBeenCalledWith(pkg.name, pkg.version)
    expect(instrumentation.isEnabled()).toBe(true)

    const tracer = getTracer()
    expect(tracer).toBeInstanceOf(OpenTelemetryTracer)
    expect(tracer!.inject).toBeTypeOf('function')
    expect(tracer!.extract).toBeTypeOf('function')
  })

  it('should support propagationEnabled=false', () => {
    void new ORPCInstrumentation({ propagationEnabled: false })

    const tracer = getTracer()
    expect(tracer).toBeInstanceOf(OpenTelemetryTracer)
    expect(tracer!.inject).toBeUndefined()
    expect(tracer!.extract).toBeUndefined()
  })

  it('should support propagationEnabled.inject=false', () => {
    void new ORPCInstrumentation({ propagationEnabled: { inject: false } })

    const tracer = getTracer()
    expect(tracer).toBeInstanceOf(OpenTelemetryTracer)
    expect(tracer!.inject).toBeUndefined()
    expect(tracer!.extract).toBeDefined()
  })

  it('should support propagationEnabled.extract=false', () => {
    void new ORPCInstrumentation({ propagationEnabled: { extract: false } })

    const tracer = getTracer()
    expect(tracer).toBeInstanceOf(OpenTelemetryTracer)
    expect(tracer!.extract).toBeUndefined()
    expect(tracer!.inject).toBeDefined()
  })

  it('should not enable if enabled=false', () => {
    const instrumentation = new ORPCInstrumentation({ enabled: false })

    expect(instrumentation.isEnabled()).toBe(false)
    expect(getTracer()).toBeUndefined()
  })

  it('can disable and re-enable the instrumentation', () => {
    const instrumentation = new ORPCInstrumentation()

    instrumentation.disable()
    expect(instrumentation.isEnabled()).toBe(false)
    expect(getTracer()).toBeUndefined()

    instrumentation.enable()
    expect(instrumentation.isEnabled()).toBe(true)
    expect(getTracer()).toBeInstanceOf(OpenTelemetryTracer)
  })

  describe('tracer provider given to registerInstrumentations', () => {
    const exporter = new InMemorySpanExporter()
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })

    beforeEach(() => {
      exporter.reset()
    })

    it.each([
      ['an enabled', {}],
      ['a disabled', { enabled: false }],
    ])(
      'receives the spans of %s instrumentation without being registered globally',
      (_, config) => {
        registerInstrumentations({
          instrumentations: [new ORPCInstrumentation(config)],
          tracerProvider: provider,
        })

        getTracer()!.startSpan('span').end()

        expect(exporter.getFinishedSpans()).toHaveLength(1)
      },
    )
  })
})
