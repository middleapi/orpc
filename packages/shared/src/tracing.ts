import { isAbortError } from './error'
import type { Promisable } from './types'

const TRACER_SYMBOL = /* @__PURE__ */ Symbol.for('ORPC_TRACER')

export type TracingAttributeValue = string | number | boolean | string[] | number[] | boolean[]

export type TracingHeaders = Record<string, string | string[] | undefined>

export type TracingExceptionLevel = 'error' | 'info'

export interface TracingSpan {
  setAttribute(key: string, value: TracingAttributeValue): void
  /**
   * Renames the span. Backends that cannot rename spans ignore it.
   */
  updateName(name: string): void
  /**
   * Adds an event to the span. Backends without span events ignore it.
   */
  addEvent(name: string): void
  /**
   * Records a thrown value on the span, the backend decides how to serialize it.
   * The `error` level also marks the span as failed.
   */
  recordException(level: TracingExceptionLevel, error: unknown): void
  end(): void
}

/**
 * The tracing backend oRPC records spans with, see `@orpc/opentelemetry` and `@orpc/cloudflare`.
 *
 * A `parent` defaults to the active span of the backend when omitted.
 */
export interface Tracer {
  /**
   * Starts a span without making it active. The caller must end it.
   */
  startSpan(name: string, parent?: TracingSpan): TracingSpan
  /**
   * Starts a span, makes it active while `fn` runs, and passes it to `fn`. The caller must end it.
   */
  startActiveSpan<T>(
    name: string,
    parent: TracingSpan | undefined,
    fn: (span: TracingSpan) => Promise<T>,
  ): Promise<T>
  getActiveSpan(): TracingSpan | undefined
  /**
   * Runs `fn` with `span` as the active span. Backends that cannot activate a span run `fn` directly.
   */
  withActiveSpan<T>(span: TracingSpan, fn: () => Promisable<T>): Promisable<T>
  /**
   * Writes the trace context of `span` into `headers`. Absent when the backend does not propagate context.
   */
  inject?(span: TracingSpan, headers: TracingHeaders): void
  /**
   * Reads the remote parent from `headers`. Absent when the backend does not propagate context.
   */
  extract?(headers: TracingHeaders): TracingSpan | undefined
}

export function setTracer(tracer: Tracer | undefined): void {
  ;(globalThis as Record<symbol, unknown>)[TRACER_SYMBOL] = tracer
}

export function getTracer(): Tracer | undefined {
  return (globalThis as Record<symbol, unknown>)[TRACER_SYMBOL] as Tracer | undefined
}

export interface StartSpanOptions {
  /**
   * The name of the span to create.
   */
  name: string
  /**
   * The span to use as parent. Defaults to the active span of the backend.
   */
  parent?: TracingSpan | undefined
}

export function startSpan(options: StartSpanOptions | string): TracingSpan | undefined {
  const tracer = getTracer()

  if (!tracer) {
    return undefined
  }

  if (typeof options === 'string') {
    return tracer.startSpan(options)
  }

  return tracer.startSpan(options.name, options.parent)
}

export function recordSpanError(span: TracingSpan | undefined, error: unknown): void {
  if (!span) {
    return
  }

  // DO NOT treat aborted error as error if happen during business logic (assumed).
  // Timeouts and closed connections are not aborts, so they are recorded as errors.
  span.recordException(isAbortError(error) ? 'info' : 'error', error)
}

export function setSpanAttributeIfDefined(
  span: TracingSpan | undefined,
  key: string,
  value: TracingAttributeValue | undefined,
): void {
  if (!span || value === undefined) {
    return
  }

  span.setAttribute(key, value)
}

export function toSpanAttributeValue(data: unknown): string {
  if (data === undefined) {
    return 'undefined'
  }

  try {
    // oxlint-disable-next-line no-restricted-properties
    return JSON.stringify(data, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString()
      }

      if (value instanceof Map || value instanceof Set) {
        return Array.from(value)
      }

      return value
    })
  } catch {
    // oxlint-disable-next-line typescript/no-base-to-string
    return String(data)
  }
}

export function runWithSpan<T>(
  options: string | StartSpanOptions,
  fn: (span?: TracingSpan) => Promisable<T>,
): Promise<T> {
  const tracer = getTracer()

  if (!tracer) {
    try {
      return Promise.resolve(fn())
    } catch (e) {
      return Promise.reject(e)
    }
  }

  return runWithTracerSpan(tracer, options, fn)
}

async function runWithTracerSpan<T>(
  tracer: Tracer,
  options: string | StartSpanOptions,
  fn: (span?: TracingSpan) => Promisable<T>,
): Promise<T> {
  const name = typeof options === 'string' ? options : options.name
  const parent = typeof options === 'string' ? undefined : options.parent

  return tracer.startActiveSpan(name, parent, async (span) => {
    try {
      return await fn(span)
    } catch (e) {
      recordSpanError(span, e)
      throw e
    } finally {
      span.end()
    }
  })
}

export function runInSpanContext<T>(
  span: TracingSpan | undefined,
  fn: () => Promisable<T>,
): Promisable<T> {
  const tracer = getTracer()

  if (!span || !tracer) {
    return fn()
  }

  return tracer.withActiveSpan(span, fn)
}
