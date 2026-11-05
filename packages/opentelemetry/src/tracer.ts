import type { Context, Tracer as OpenTelemetryApiTracer, Span } from '@opentelemetry/api'
import {
  context,
  INVALID_SPAN_CONTEXT,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import type {
  Promisable,
  Tracer,
  TracingAttributeValue,
  TracingException,
  TracingExceptionLevel,
  TracingSpan,
} from '@orpc/shared'

export class OpenTelemetrySpan implements TracingSpan {
  readonly span: Span

  constructor(
    /**
     * The context the span was started or extracted in, with the span set as its active span.
     * Children and `withActiveSpan` use it as-is, so baggage and other context values are kept
     * even when the span is used later, e.g. while a streamed response is consumed.
     *
     * An extracted parent with only baggage has no span here, so its children start a new trace.
     */
    readonly context: Context,
  ) {
    this.span = trace.getSpan(context) ?? trace.wrapSpanContext(INVALID_SPAN_CONTEXT)
  }

  setAttribute(key: string, value: TracingAttributeValue): void {
    this.span.setAttribute(key, value)
  }

  updateName(name: string): void {
    this.span.updateName(name)
  }

  addEvent(name: string): void {
    this.span.addEvent(name)
  }

  recordException(level: TracingExceptionLevel, exception: TracingException): void {
    this.span.recordException(exception)

    if (level === 'error') {
      this.span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message })
    }
  }

  end(): void {
    this.span.end()
  }
}

export interface OpenTelemetryTracerOptions {
  /**
   * Called for every span, so a tracer provider set after construction is picked up.
   */
  tracer: () => OpenTelemetryApiTracer

  /**
   * @default true
   */
  propagationEnabled?: boolean | undefined
}

export class OpenTelemetryTracer implements Tracer {
  private readonly tracer: () => OpenTelemetryApiTracer

  readonly inject: Tracer['inject']
  readonly extract: Tracer['extract']

  constructor(options: OpenTelemetryTracerOptions) {
    this.tracer = options.tracer

    if (options.propagationEnabled ?? true) {
      this.inject = (span, headers) => {
        propagation.inject(contextOf(span), headers)
      }

      this.extract = (headers) => {
        const active = context.active()
        const extracted = withActiveBaggage(propagation.extract(active, headers), active)

        return extracted === active && trace.getSpan(active) === undefined
          ? undefined
          : new OpenTelemetrySpan(extracted)
      }
    }
  }

  startSpan(name: string, parent?: TracingSpan): TracingSpan {
    const parentContext = contextOf(parent)
    const span = this.tracer().startSpan(name, undefined, parentContext)

    return new OpenTelemetrySpan(trace.setSpan(parentContext, span))
  }

  startActiveSpan<T>(
    name: string,
    parent: TracingSpan | undefined,
    fn: (span: TracingSpan) => Promise<T>,
  ): Promise<T> {
    // Same as the OpenTelemetry SDK's startActiveSpan, but the stored context does not depend on a context manager
    const span = this.startSpan(name, parent) as OpenTelemetrySpan
    return context.with(span.context, fn, undefined, span)
  }

  getActiveSpan(): TracingSpan | undefined {
    const active = context.active()
    return trace.getSpan(active) === undefined ? undefined : new OpenTelemetrySpan(active)
  }

  withActiveSpan<T>(span: TracingSpan, fn: () => Promisable<T>): Promisable<T> {
    return context.with(contextOf(span), fn)
  }
}

/**
 * No span, or a span of another tracer (e.g. one set while a request was running), falls back to the active context.
 */
function contextOf(span: TracingSpan | undefined): Context {
  return span instanceof OpenTelemetrySpan ? span.context : context.active()
}

/**
 * The baggage propagator replaces the baggage of the context it extracts into,
 * so entries already set (e.g. by an HTTP instrumentation or middleware) are added back, and win on conflict.
 */
function withActiveBaggage(extracted: Context, active: Context): Context {
  const fromHeaders = propagation.getBaggage(extracted)
  const current = propagation.getBaggage(active)

  if (fromHeaders === undefined || current === undefined || fromHeaders === current) {
    return extracted
  }

  return propagation.setBaggage(
    extracted,
    propagation.createBaggage(
      Object.fromEntries([...fromHeaders.getAllEntries(), ...current.getAllEntries()]),
    ),
  )
}
