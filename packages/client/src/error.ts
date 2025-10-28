import type { MaybeOptionalOptions } from '@orpc/shared'
import { getConstructor, isObject, resolveMaybeOptionalOptions } from '@orpc/shared'
import { ORPC_CLIENT_PACKAGE_NAME, ORPC_CLIENT_PACKAGE_VERSION } from './consts'

export const COMMON_ORPC_ERROR_DEFS = {
  BAD_REQUEST: {
    status: 400,
    message: 'Bad Request',
  },
  UNAUTHORIZED: {
    status: 401,
    message: 'Unauthorized',
  },
  FORBIDDEN: {
    status: 403,
    message: 'Forbidden',
  },
  NOT_FOUND: {
    status: 404,
    message: 'Not Found',
  },
  METHOD_NOT_SUPPORTED: {
    status: 405,
    message: 'Method Not Supported',
  },
  NOT_ACCEPTABLE: {
    status: 406,
    message: 'Not Acceptable',
  },
  TIMEOUT: {
    status: 408,
    message: 'Request Timeout',
  },
  CONFLICT: {
    status: 409,
    message: 'Conflict',
  },
  PRECONDITION_FAILED: {
    status: 412,
    message: 'Precondition Failed',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    message: 'Payload Too Large',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: 'Unsupported Media Type',
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Unprocessable Content',
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'Too Many Requests',
  },
  CLIENT_CLOSED_REQUEST: {
    status: 499,
    message: 'Client Closed Request',
  },

  INTERNAL_SERVER_ERROR: {
    status: 500,
    message: 'Internal Server Error',
  },
  NOT_IMPLEMENTED: {
    status: 501,
    message: 'Not Implemented',
  },
  BAD_GATEWAY: {
    status: 502,
    message: 'Bad Gateway',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'Service Unavailable',
  },
  GATEWAY_TIMEOUT: {
    status: 504,
    message: 'Gateway Timeout',
  },
} as const

export type CommonORPCErrorCode = keyof typeof COMMON_ORPC_ERROR_DEFS

export type ORPCErrorCode = CommonORPCErrorCode | (string & {})

export function fallbackORPCErrorStatus(code: ORPCErrorCode, status: number | undefined): number {
  return status ?? (COMMON_ORPC_ERROR_DEFS as any)[code]?.status ?? 500
}

export function fallbackORPCErrorMessage(code: ORPCErrorCode, message: string | undefined): string {
  return message || (COMMON_ORPC_ERROR_DEFS as any)[code]?.message || code
}

export type ORPCErrorOptions<TData>
  = & ErrorOptions
    & { defined?: boolean, status?: number, message?: string }
    & (undefined extends TData ? { data?: TData } : { data: TData })

/**
 * Store all ORPCError constructors
 * for workaround of instanceof check in case multiple dependency graphs exist
 *
 * @info `Symbol.for` is global symbol registry and shared across different dependency graphs
 */
const GLOBAL_ORPC_ERROR_CONSTRUCTORS_SYMBOL = Symbol.for(`__${ORPC_CLIENT_PACKAGE_NAME}@${ORPC_CLIENT_PACKAGE_VERSION}/error/ORPC_ERROR_CONSTRUCTORS__`)
void ((globalThis as any)[GLOBAL_ORPC_ERROR_CONSTRUCTORS_SYMBOL] ??= new WeakSet())
const globalORPCErrorConstructors: WeakSet<object> = (globalThis as any)[GLOBAL_ORPC_ERROR_CONSTRUCTORS_SYMBOL]

export class ORPCError<TCode extends ORPCErrorCode, TData> extends Error {
  readonly defined: boolean
  readonly code: TCode
  readonly status: number
  readonly data: TData

  constructor(code: TCode, ...rest: MaybeOptionalOptions<ORPCErrorOptions<TData>>) {
    const options = resolveMaybeOptionalOptions(rest)

    if (options.status !== undefined && !isORPCErrorStatus(options.status)) {
      throw new Error('[ORPCError] Invalid error status code.')
    }

    const message = fallbackORPCErrorMessage(code, options.message)

    super(message, options)

    this.code = code
    this.status = fallbackORPCErrorStatus(code, options.status)
    this.defined = options.defined ?? false
    this.data = options.data as TData // data only optional when TData is undefinable so can safely cast here
  }

  toJSON(): ORPCErrorJSON<TCode, TData> {
    return {
      defined: this.defined,
      code: this.code,
      status: this.status,
      message: this.message,
      data: this.data,
    }
  }

  /**
   * Workaround for Next.js where different contexts use separate
   * dependency graphs, causing multiple ORPCError constructors existing and breaking
   * `instanceof` checks across contexts.
   *
   * This is particularly problematic with "Optimized SSR", where orpc-client
   * executes in one context but is invoked from another. When an error is thrown
   * in the execution context, `instanceof ORPCError` checks fail in the
   * invocation context due to separate class constructors.
   *
   * @todo Remove this and related code if Next.js resolves the multiple dependency graph issue.
   */
  static override[Symbol.hasInstance](instance: unknown): boolean {
    // not applicable to extended classes
    if (globalORPCErrorConstructors.has(this)) {
      const constructor = getConstructor(instance)
      if (constructor && globalORPCErrorConstructors.has(constructor)) {
        return true
      }
    }

    // fallback to default instanceof check
    return super[Symbol.hasInstance](instance)
  }
}
/**
 * Store ORPCError constructor
 * for workaround of instanceof check in case multiple dependency graphs exist
 */
globalORPCErrorConstructors.add(ORPCError)

export type ORPCErrorJSON<TCode extends string, TData> = Pick<ORPCError<TCode, TData>, 'defined' | 'code' | 'status' | 'message' | 'data'>

export function isDefinedError<T>(error: T): error is Extract<T, ORPCError<any, any>> {
  return error instanceof ORPCError && error.defined
}

export function toORPCError(error: unknown): ORPCError<any, any> {
  return error instanceof ORPCError
    ? error
    : new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Internal server error',
        cause: error,
      })
}

export function isORPCErrorStatus(status: number): boolean {
  return status < 200 || status >= 400
}

export function isORPCErrorJson(json: unknown): json is ORPCErrorJSON<ORPCErrorCode, unknown> {
  if (!isObject(json)) {
    return false
  }

  const validKeys = ['defined', 'code', 'status', 'message', 'data']
  if (Object.keys(json).some(k => !validKeys.includes(k))) {
    return false
  }

  return 'defined' in json
    && typeof json.defined === 'boolean'
    && 'code' in json
    && typeof json.code === 'string'
    && 'status' in json
    && typeof json.status === 'number'
    && isORPCErrorStatus(json.status)
    && 'message' in json
    && typeof json.message === 'string'
}

export function createORPCErrorFromJson<TCode extends ORPCErrorCode, TData>(
  json: ORPCErrorJSON<TCode, TData>,
  options: ErrorOptions = {},
): ORPCError <TCode, TData> {
  return new ORPCError(json.code, {
    ...options,
    ...json,
  })
}
