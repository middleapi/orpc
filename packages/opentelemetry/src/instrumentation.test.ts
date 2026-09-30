import { trace } from '@opentelemetry/api'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import * as SharedModule from '@orpc/shared'
import pkg from '../package.json'
import { ORPCInstrumentation } from './instrumentation'
import { OpenTelemetryTracer } from './tracer'

const setTracerSpy = vi.spyOn(SharedModule, 'setTracer').mockImplementation(() => {})
const getTracerSpy = vi.spyOn(trace, 'getTracer')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('oRPCInstrumentation', () => {
  it('should initialize the instrumentation and enable by default', () => {
    void new ORPCInstrumentation()

    expect(getTracerSpy).toHaveBeenCalledWith(pkg.name, pkg.version)
    expect(setTracerSpy).toHaveBeenCalledTimes(1)

    const tracer = setTracerSpy.mock.calls[0]![0]
    expect(tracer).toBeInstanceOf(OpenTelemetryTracer)
    expect(tracer!.inject).toBeTypeOf('function')
    expect(tracer!.extract).toBeTypeOf('function')
  })

  it('should support propagationEnabled=false', () => {
    void new ORPCInstrumentation({ propagationEnabled: false })

    const tracer = setTracerSpy.mock.calls[0]![0]
    expect(tracer).toBeInstanceOf(OpenTelemetryTracer)
    expect(tracer!.inject).toBeUndefined()
    expect(tracer!.extract).toBeUndefined()
  })

  it('should not enable if enabled=false', () => {
    void new ORPCInstrumentation({ enabled: false })
    expect(setTracerSpy).not.toHaveBeenCalled()
  })

  it('can disable the instrumentation', () => {
    const instrumentation = new ORPCInstrumentation()
    instrumentation.disable()
    expect(setTracerSpy).toHaveBeenCalledWith(undefined)
  })

  describe('tracer provider', () => {
    const exporter = new InMemorySpanExporter()
    // Deliberately never registered globally
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    beforeEach(() => {
      exporter.reset()
    })

    afterAll(async () => {
      await provider.shutdown()
    })

    function startSpanWithLatestTracer(name: string) {
      const tracer = setTracerSpy.mock.calls.at(-1)![0]!
      tracer.startSpan(name).end()
    }

    it('sends spans to the tracer provider given to registerInstrumentations without registering it globally', () => {
      const instrumentation = new ORPCInstrumentation()

      const unregister = registerInstrumentations({
        instrumentations: [instrumentation],
        tracerProvider: provider,
      })

      expect(setTracerSpy).toHaveBeenCalledTimes(2)
      startSpanWithLatestTracer('registered')
      expect(exporter.getFinishedSpans().map(span => span.name)).toEqual(['registered'])
      expect(exporter.getFinishedSpans()[0]!.instrumentationScope).toEqual(expect.objectContaining({ name: pkg.name, version: pkg.version }))

      unregister()
      expect(setTracerSpy).toHaveBeenLastCalledWith(undefined)
    })

    it('uses the tracer provider when registerInstrumentations enables a disabled instrumentation', () => {
      const instrumentation = new ORPCInstrumentation({ enabled: false })

      registerInstrumentations({
        instrumentations: [instrumentation],
        tracerProvider: provider,
      })

      expect(setTracerSpy).toHaveBeenCalledTimes(1)
      startSpanWithLatestTracer('enabled-later')
      expect(exporter.getFinishedSpans().map(span => span.name)).toEqual(['enabled-later'])
    })

    it('does not install a tracer when the tracer provider changes while disabled', () => {
      const disabled = new ORPCInstrumentation({ enabled: false })
      disabled.setTracerProvider(provider)

      const enabledThenDisabled = new ORPCInstrumentation()
      enabledThenDisabled.disable()
      enabledThenDisabled.setTracerProvider(provider)

      expect(setTracerSpy.mock.calls).toEqual([[expect.any(OpenTelemetryTracer)], [undefined]])
    })
  })
})
