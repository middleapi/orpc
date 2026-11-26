import type { InstrumentationConfig } from '@opentelemetry/instrumentation'
import { InstrumentationBase } from '@opentelemetry/instrumentation'
import { getTracer, setTracer } from '@orpc/shared'

import pkg from '../package.json' with { type: 'json' }
import type { OpenTelemetryPropagationOptions } from './tracer'
import { OpenTelemetryTracer } from './tracer'

export interface ORPCInstrumentationConfig extends InstrumentationConfig {
  /**
   * Automatic OpenTelemetry context/span propagation. `false` disables it,
   * {@link OpenTelemetryPropagationOptions} controls each direction separately.
   *
   * Disable this if propagation is handled elsewhere or managed manually.
   *
   * @default true
   */
  propagation?: boolean | OpenTelemetryPropagationOptions | undefined
}

/**
 * OpenTelemetry instrumentation for oRPC. Automatically instruments both
 * client and server for distributed tracing.
 *
 * @see {@link https://orpc.dev/docs/integrations/opentelemetry | OpenTelemetry Integration}
 */
export class ORPCInstrumentation extends InstrumentationBase<ORPCInstrumentationConfig> {
  constructor(config: ORPCInstrumentationConfig = {}) {
    super(pkg.name, pkg.version, config)
  }

  protected override init(): void {}

  override enable(): void {
    setTracer(
      new OpenTelemetryTracer({
        tracer: () => this.tracer,
        propagation: this.getConfig().propagation,
      }),
    )
  }

  override disable(): void {
    setTracer(undefined)
  }

  override isEnabled(): boolean {
    return getTracer() !== undefined
  }
}
