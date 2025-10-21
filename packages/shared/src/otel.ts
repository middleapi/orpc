/**
 * Only import types from @opentelemetry/api to avoid runtime dependencies.
 */
import type { AttributeValue, Context, ContextAPI, Exception, PropagationAPI, Span, SpanOptions, SpanStatusCode, TraceAPI, Tracer } from '@opentelemetry/api'
import type { Promisable } from 'type-fest'
import { ORPC_SHARED_PACKAGE_NAME, ORPC_SHARED_PACKAGE_VERSION } from './consts'

const SPAN_ERROR_STATUS = 2 satisfies SpanStatusCode.ERROR // avoid runtime dependency on @opentelemetry/api

/**
 * Symbol used to add the sentry scope to the open telemetry context.
 *
 * See https://github.com/getsentry/sentry-javascript/blob/910b40bb38635d1889a97f701c46c44fb3038b93/packages/opentelemetry/src/constants.ts#L12
 */
const SENTRY_SCOPE_SYMBOL = Symbol.for('sentry_scopes')

/**
 * We should use globalThis + a unique key to store global state.
 * If use a global variable/symbol, it can create multiple instances in different contexts.
 */
const GLOBAL_OTEL_CONFIG_KEY = `__${ORPC_SHARED_PACKAGE_NAME}@${ORPC_SHARED_PACKAGE_VERSION}/otel/config__`

export interface OtelConfig {
  tracer: Tracer
  trace: TraceAPI
  context: ContextAPI
  propagation: PropagationAPI
}

/**
 * Sets the global OpenTelemetry config.
 * Call this once at app startup. Use `undefined` to disable tracing.
 */
export function setGlobalOtelConfig(config: OtelConfig | undefined): void {
  (globalThis as any)[GLOBAL_OTEL_CONFIG_KEY] = config
}

/**
 * Gets the global OpenTelemetry config.
 * Returns `undefined` if OpenTelemetry is not configured, initialized, or enabled.
 */
export function getGlobalOtelConfig(): OtelConfig | undefined {
  return (globalThis as any)[GLOBAL_OTEL_CONFIG_KEY]
}

/**
 * Starts a new OpenTelemetry span with the given name and options.
 *
 * @returns The new span, or `undefined` if no tracer is set.
 */
export function startSpan(name: string, options: SpanOptions = {}, context?: Context): Span | undefined {
  const tracer = getGlobalOtelConfig()?.tracer
  return tracer?.startSpan(name, options, context)
}

export interface SetSpanErrorOptions {
  /**
   * Span error status is not set if error is due to cancellation by the signal.
   */
  signal?: AbortSignal
}

/**
 * Records and sets the error status on the given span.
 * If the span is `undefined`, it does nothing.
 */
export function setSpanError(span: Span | undefined, error: unknown, options: SetSpanErrorOptions = {}): void {
  if (!span) {
    return
  }

  const exception = toOtelException(error)
  span.recordException(exception)

  if (!options.signal?.aborted || options.signal.reason !== error) {
    span.setStatus({
      code: SPAN_ERROR_STATUS,
      message: exception.message,
    })
  }
}

export function setSpanAttribute(span: Span | undefined, key: string, value: AttributeValue | undefined): void {
  if (!span || value === undefined) {
    return
  }

  span.setAttribute(key, value)
}

/**
 * Converts an error to an OpenTelemetry Exception.
 */
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

/**
 * Converts a value to a string suitable for OpenTelemetry span attributes.
 */
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

export interface RunWithSpanOptions extends SpanOptions, SetSpanErrorOptions {
  /**
   * The name of the span to create.
   */
  name: string

  /**
   * Context to use for the span.
   */
  context?: Context
}

/**
 * Runs a function within the context of a new OpenTelemetry span.
 * The span is ended automatically, and errors are recorded to the span.
 */
export async function runWithSpan<T>(
  { name, context, ...options }: RunWithSpanOptions,
  fn: (span?: Span) => Promisable<T>,
): Promise<T> {
  const tracer = getGlobalOtelConfig()?.tracer

  if (!tracer) {
    return fn()
  }

  const callback = async (span: Span) => {
    try {
      return await fn(span)
    }
    catch (e) {
      setSpanError(span, e, options)
      throw e
    }
    finally {
      span.end()
    }
  }

  if (context) {
    return tracer.startActiveSpan(name, options, context, callback)
  }
  else {
    return tracer.startActiveSpan(name, options, callback)
  }
}

/**
 * Runs a function within the context of an existing OpenTelemetry span.
 */
export async function runInSpanContext<T>(
  span: Span | undefined,
  fn: () => Promisable<T>,
): Promise<T> {
  const otelConfig = getGlobalOtelConfig()

  if (!span || !otelConfig) {
    return fn()
  }

  const ctx = otelConfig.trace.setSpan(otelConfig.context.active(), span)
  return otelConfig.context.with(ctx, fn)
}

/**
 * Checks if the current context is a Sentry context.
 */
export function isInSentryContext(): boolean {
  const context = getGlobalOtelConfig()?.context
  return context?.active()?.getValue(SENTRY_SCOPE_SYMBOL) !== undefined
}
