// eslint-disable-next-line no-restricted-imports
import { context, propagation, trace } from '@opentelemetry/api'
import * as SharedModule from '@orpc/shared'
import pkg from '../package.json'
import { ORPCInstrumentation } from './instrumentation'

const setOpenTelemetryConfigSpy = vi.spyOn(SharedModule, 'setOpenTelemetryConfig').mockImplementation(() => {})
const getTracerSpy = vi.spyOn(trace, 'getTracer')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('oRPCInstrumentation', () => {
  it('should initialize the instrumentation and enable by default', () => {
    void new ORPCInstrumentation()

    expect(getTracerSpy).toHaveBeenCalledWith(pkg.name, pkg.version)
    expect(setOpenTelemetryConfigSpy).toHaveBeenCalledTimes(1)
    expect(setOpenTelemetryConfigSpy).toHaveBeenNthCalledWith(1, {
      tracer: expect.any(Object), // tracer is result of getTracer
      trace,
      context,
      propagation,
    })
  })

  it('should support propagationEnabled=false', () => {
    void new ORPCInstrumentation({ propagationEnabled: false })

    expect(setOpenTelemetryConfigSpy).toHaveBeenCalledWith({
      tracer: expect.any(Object), // tracer is result of getTracer
      trace,
      context,
      propagation: undefined,
    })
  })

  it('should not enable if enabled=false', () => {
    void new ORPCInstrumentation({ enabled: false })
    expect(setOpenTelemetryConfigSpy).not.toHaveBeenCalled()
  })

  it('can disable the instrumentation', () => {
    const instrumentation = new ORPCInstrumentation()
    instrumentation.disable()
    expect(setOpenTelemetryConfigSpy).toHaveBeenCalledWith(undefined)
  })
})
