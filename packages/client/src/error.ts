import type { MaybeOptionalOptions, Registry } from '@orpc/shared'
import { getConstructor, resolveMaybeOptionalOptions } from '@orpc/shared'

export const COMMON_ERROR_STATUS_MAP = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  NOT_ACCEPTABLE: 406,
  TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_CONTENT: 422,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
}

export type ORPCErrorCode
  = Registry extends { ORPCErrorCode: infer T extends string }
    ? T
    : (keyof typeof COMMON_ERROR_STATUS_MAP) | (string & {})

export type ORPCErrorOptions<TData>
  = & ErrorOptions
    & { message?: string }
    & (undefined extends TData ? { data?: TData } : { data: TData })

let ORPCErrorConstructors: WeakSet<object>

export class ORPCError<TCode extends ORPCErrorCode, TData> extends Error {
  /**
   * Placed inside a static block (rather than at module level) to ensure this
   * registration is treated as part of the class definition by bundlers.
   *
   * With `"sideEffects": false` in package.json, bundlers like webpack/Rollup
   * are allowed to tree-shake any module-level statements that appear to have
   * no consumers. A free-floating `globalORPCErrorConstructors.add(ORPCError)`
   * at module level could be dropped entirely if the bundler decides the module
   * is only partially used.
   *
   * By placing this inside `static {}`, the registration becomes inseparable
   * from the class body itself — a bundler cannot include `ORPCError` without
   * executing this block.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Static_initialization_blocks
   */
  static {
    /**
     * Store all ORPCError constructors
     * for workaround of instanceof check in case multiple dependency graphs exist
     */
    const ORPC_ERROR_CONSTRUCTORS_SYMBOL = Symbol.for('ORPC_ERROR_CONSTRUCTORS')
    void ((globalThis as any)[ORPC_ERROR_CONSTRUCTORS_SYMBOL] ??= new WeakSet())
    ORPCErrorConstructors = (globalThis as any)[ORPC_ERROR_CONSTRUCTORS_SYMBOL]
    ORPCErrorConstructors.add(ORPCError)
  }

  /**
   * @info
   * The `__branch` property is used for type branding, helping TypeScript distinguish
   * an `ORPCError` instance from plain objects with a similar structure.
   */
  override readonly name = 'ORPCError' as 'ORPCError' & { __branch: 'ORPCError' }

  /**
   * Indicates whether the error matches a definition in the procedure's `.errors` map.
   */
  readonly defined: boolean = false

  /**
   * Indicates whether the error's type is inferable at the TypeScript level.
   * This is typically true when the error is explicitly defined or returned within a handler.
   */
  readonly inferable: boolean = false

  code: TCode
  data: TData

  constructor(code: TCode, ...rest: MaybeOptionalOptions<ORPCErrorOptions<TData>>) {
    const options = resolveMaybeOptionalOptions(rest)
    const message = options.message ?? code.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')

    super(message, options)

    this.code = code
    this.data = options.data as TData // data only optional when TData is undefinable so can safely cast here
  }

  toJSON(): ORPCErrorJSON<TCode, TData> {
    return {
      defined: this.defined,
      inferable: this.inferable,
      code: this.code,
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
    if (!ORPCErrorConstructors.has(this)) {
      // not applicable to extended classes
      return super[Symbol.hasInstance](instance)
    }

    const constructor = getConstructor(instance)
    if (constructor && ORPCErrorConstructors.has(constructor)) {
      return true
    }

    // fallback to default instanceof check
    return super[Symbol.hasInstance](instance)
  }
}

export interface ORPCErrorJSON<TCode extends string, TData> extends Pick<ORPCError<TCode, TData>, 'code' | 'message' | 'data'> {
  /**
   * remove readonly
   */
  defined: boolean
  /**
   * remove readonly
   */
  inferable: boolean
}

export type AnyORPCError = ORPCError<any, any>
export type AnyORPCErrorJSON = ORPCErrorJSON<any, any>
