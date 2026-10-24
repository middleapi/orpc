import type { Promisable, Tracer, TracingAttributeValue, TracingException, TracingExceptionLevel, TracingSpan } from '@orpc/shared'
import { setTracer, toSpanAttributeValue } from '@orpc/shared'
/**
 * A namespace import keeps `@orpc/cloudflare` loadable on runtimes that predate the
 * `tracing` export, so users of the other adapters are not affected by it.
 */
import * as workers from 'cloudflare:workers'

class CloudflareSpan implements TracingSpan {
  constructor(readonly span: Span) {}

  setAttribute(key: string, value: TracingAttributeValue): void {
    this.span.setAttribute(key, Array.isArray(value) ? toSpanAttributeValue(value) : value)
  }

  updateName(name: string): void {
    this.span.updateName(name)
  }

  addEvent(_name: string): void {
    // Workers Traces have no custom span events
  }

  recordException(level: TracingExceptionLevel, exception: TracingException): void {
    this.span.recordException(exception)

    if (level === 'error') {
      this.span.setStatus({ code: 'error', message: exception.message })
    }
  }

  end(): void {
    this.span.end()
  }
}

export { CloudflareSpan as experimental_CloudflareSpan }

export interface experimental_CloudflareTracerOptions {
  /**
   * The Workers tracing API to record spans with.
   *
   * @default tracing from `cloudflare:workers`
   */
  tracing?: Tracing | undefined

  /**
   * Whether oRPC links send a W3C `traceparent` header, so servers outside Cloudflare join the trace.
   *
   * @default true
   */
  propagationEnabled?: boolean | undefined
}

/**
 * Workers report all-zero IDs when tracing is disabled.
 */
const INVALID_TRACE_ID = '00000000000000000000000000000000'

/**
 * Records oRPC spans with Cloudflare Workers Traces.
 *
 * @see {@link https://orpc.dev/docs/integrations/cloudflare-traces | Cloudflare Workers Traces Integration}
 */
export class experimental_CloudflareTracer implements Tracer {
  private readonly tracing: Tracing

  readonly inject: Tracer['inject']

  constructor(options: experimental_CloudflareTracerOptions = {}) {
    this.tracing = options.tracing ?? workers.tracing

    if (options.propagationEnabled ?? true) {
      this.inject = (span, headers) => {
        const { traceId, spanId } = (span as CloudflareSpan).span.spanContext()

        if (traceId === INVALID_TRACE_ID) {
          return
        }

        /**
         * Workers sample traces after the invocation, and `traceFlags` only echoes an upstream decision,
         * so the sampled flag is always set: it means the trace may have been recorded.
         */
        headers.traceparent = `00-${traceId}-${spanId}-01`
      }
    }
  }

  startSpan(name: string): TracingSpan {
    // Workers Traces nest spans by async context, so the parent option is not needed
    return new CloudflareSpan(this.tracing.startSpan(name))
  }

  startActiveSpan<T>(name: string, _parent: TracingSpan | undefined, fn: (span: TracingSpan) => Promise<T>): Promise<T> {
    return this.tracing.startActiveSpan(name, span => fn(new CloudflareSpan(span)))
  }

  getActiveSpan(): TracingSpan | undefined {
    const span = this.tracing.getActiveSpan()
    return span === undefined ? undefined : new CloudflareSpan(span)
  }

  withActiveSpan<T>(_span: TracingSpan, fn: () => Promisable<T>): Promisable<T> {
    // Workers Traces cannot activate an existing span
    return fn()
  }

  /**
   * Makes oRPC record its spans with this tracer.
   */
  enable(): void {
    setTracer(this)
  }

  disable(): void {
    setTracer(undefined)
  }
}
