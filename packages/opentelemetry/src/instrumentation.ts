import type { TracerProvider } from '@opentelemetry/api'
import type { InstrumentationConfig, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation'
import { context, propagation, trace } from '@opentelemetry/api'
import { InstrumentationBase } from '@opentelemetry/instrumentation'
import { setTracer } from '@orpc/shared'
import pkg from '../package.json'
import { OpenTelemetryTracer } from './tracer'

export interface ORPCInstrumentationConfig extends InstrumentationConfig {
  /**
   * Whether to enable automatic OpenTelemetry context/span propagation.
   *
   * Disable this if propagation is handled elsewhere or managed manually.
   *
   * @default true
   */
  propagationEnabled?: boolean
}

/**
 * OpenTelemetry instrumentation for oRPC. Automatically instruments both
 * client and server for distributed tracing.
 *
 * @see {@link https://orpc.dev/docs/integrations/opentelemetry | OpenTelemetry Integration}
 */
export class ORPCInstrumentation extends InstrumentationBase<ORPCInstrumentationConfig> {
  /**
   * Declared without an initializer, because `InstrumentationBase` calls `enable()` from its
   * constructor, and an initializer would run afterwards and reset it.
   */
  private declare tracerInstalled: boolean | undefined

  constructor(config: ORPCInstrumentationConfig = {}) {
    super(pkg.name, pkg.version, config)
  }

  protected override init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
  }

  override enable(): void {
    this.tracerInstalled = true

    setTracer(new OpenTelemetryTracer({
      // Comes from the tracer provider passed to `registerInstrumentations`, or the global one by default
      tracer: this.tracer,
      trace,
      context,
      propagation: (this._config.propagationEnabled ?? true) ? propagation : undefined,
    }))
  }

  override disable(): void {
    this.tracerInstalled = false

    setTracer(undefined)
  }

  /**
   * `registerInstrumentations` sets the tracer provider after the constructor has already enabled
   * the instrumentation, so the oRPC tracer is rebuilt to send spans to the new provider.
   */
  override setTracerProvider(tracerProvider: TracerProvider): void {
    super.setTracerProvider(tracerProvider)

    if (this.tracerInstalled) {
      this.enable()
    }
  }
}
