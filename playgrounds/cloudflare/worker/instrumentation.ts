import type { ResolveConfigFn } from '@microlabs/otel-cf-workers'
import { ORPCInstrumentation } from '@orpc/opentelemetry'

export const INSTRUMENTATION_CONFIG: ResolveConfigFn = (_env: Env, _trigger) => {
  void new ORPCInstrumentation()

  return {
    exporter: {
      url: 'http://localhost:4318/v1/traces',
    },
    service: { name: 'cloudflare-playground' },
  }
}
