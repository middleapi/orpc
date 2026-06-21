/**
 * Only import types from @opentelemetry/api to avoid runtime dependencies.
 */
import type { AttributeValue, Context, ContextAPI, Exception, PropagationAPI, Span, SpanOptions, SpanStatusCode, TraceAPI, Tracer } from '@opentelemetry/api'
import type { Promisable } from 'type-fest'
import { isAbortError } from './error'

/**
 * This variable is used to avoid runtime dependency on @opentelemetry/api
 */
const SPAN_ERROR_STATUS = 2 satisfies SpanStatusCode.ERROR

const OPENTELEMETRY_CONFIG_SYMBOL = Symbol.for('ORPC_OPENTELEMETRY_CONFIG')

export interface OpenTelemetryConfig {
  tracer: Tracer
  trace: TraceAPI
  context: ContextAPI

  /**
   * propagation is optional, can reduce bundle size in some cases.
   */
  propagation?: PropagationAPI | undefined
}

export function setOpenTelemetryConfig(config: OpenTelemetryConfig | undefined): void {
  (globalThis as Record<symbol, unknown>)[OPENTELEMETRY_CONFIG_SYMBOL] = config
}

export function getOpenTelemetryConfig(): OpenTelemetryConfig | undefined {
  return (globalThis as Record<symbol, unknown>)[OPENTELEMETRY_CONFIG_SYMBOL] as OpenTelemetryConfig | undefined
}

export interface StartSpanOptions extends SpanOptions {
  /**
   * The name of the span to create.
   */
  name: string
  /**
   * Context to use for the created span.
   */
  context?: Context
}

export function startSpan(options: StartSpanOptions | string): Span | undefined {
  const tracer = getOpenTelemetryConfig()?.tracer

  if (!tracer) {
    return undefined
  }

  const { name, context, ...spanOptions } = typeof options === 'string' ? { name: options } : options
  return tracer.startSpan(name, spanOptions, context)
}

export function recordSpanError(span: Span | undefined, error: unknown): void {
  if (!span) {
    return
  }

  const exception = toOtelException(error)
  span.recordException(exception)

  // DO NOT treat aborted error as error if happen during business logic (assumed)
  if (!isAbortError(error)) {
    span.setStatus({
      code: SPAN_ERROR_STATUS,
      message: exception.message,
    })
  }
}

export function setSpanAttributeIfDefined(span: Span | undefined, key: string, value: AttributeValue | undefined): void {
  if (!span || value === undefined) {
    return
  }

  span.setAttribute(key, value)
}

export function toOtelException(error: unknown): Exclude<Exception, string> {
  if (error instanceof Error) {
    const exception: Exclude<Exception, string> = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }

    if ('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')) {
      exception.code = error.code
    }

    return exception
  }

  return { message: String(error) }
}

export function toSpanAttributeValue(data: unknown): string {
  if (data === undefined) {
    return 'undefined'
  }

  try {
    // eslint-disable-next-line ban/ban
    return JSON.stringify(data, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString()
      }

      if (value instanceof Map || value instanceof Set) {
        return Array.from(value)
      }

      return value
    })
  }
  catch {
    return String(data)
  }
}

export interface RunWithSpanOptions extends StartSpanOptions {
}

export async function runWithSpan<T>(
  options: string | RunWithSpanOptions,
  fn: (span?: Span) => Promisable<T>,
): Promise<T> {
  const tracer = getOpenTelemetryConfig()?.tracer

  if (!tracer) {
    return fn()
  }

  if (typeof options === 'string') {
    options = { name: options }
  }

  const callback = async (span: Span) => {
    try {
      return await fn(span)
    }
    catch (e) {
      recordSpanError(span, e)
      throw e
    }
    finally {
      span.end()
    }
  }

  if (options.context) {
    return tracer.startActiveSpan(options.name, options, options.context, callback)
  }
  else {
    return tracer.startActiveSpan(options.name, options, callback)
  }
}

export async function runInSpanContext<T>(
  span: Span | undefined,
  fn: () => Promisable<T>,
): Promise<T> {
  const otelConfig = getOpenTelemetryConfig()

  if (!span || !otelConfig) {
    return fn()
  }

  const ctx = otelConfig.trace.setSpan(otelConfig.context.active(), span)
  return otelConfig.context.with(ctx, fn)
}
