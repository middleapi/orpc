import type { ErrorMap, ErrorMapItem } from './error-map'
import type { ORPCErrorCode, ORPCErrorOptions } from './error-orpc'
import type { SchemaInput } from './schema'
import { fallbackORPCErrorStatus, ORPCError } from './error-orpc'

export function isDefinedError<T>(error: T): error is Extract<T, ORPCError<any, any>> {
  return error instanceof ORPCError && error.defined
}

export type ORPCErrorConstructorMapItemOptions<TData> = Omit<ORPCErrorOptions<TData>, 'defined' | 'status'>

export type ORPCErrorConstructorMapItemRest<TData> =
  | [options: ORPCErrorConstructorMapItemOptions<TData>]
  | (undefined extends TData ? [] : never)

export type ORPCErrorConstructorMapItem<TCode extends ORPCErrorCode, TInData> =
  (...rest: ORPCErrorConstructorMapItemRest<TInData>) => ORPCError<TCode, TInData>

export type ORPCErrorConstructorMap<T extends ErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<infer UInputSchema>
      ? ORPCErrorConstructorMapItem<K, SchemaInput<UInputSchema>>
      : never
    : never
}

export function createORPCErrorConstructorMap<T extends ErrorMap>(errors: T): ORPCErrorConstructorMap<T> {
  /**
   * Must use proxy to make sure any arbitrary access can be handled.
   */
  const proxy = new Proxy(errors, {
    get(target, code) {
      if (typeof code !== 'string') {
        return Reflect.get(target, code)
      }

      const item: ORPCErrorConstructorMapItem<string, unknown> = (...[options]) => {
        const config = errors[code]

        return new ORPCError(code, {
          defined: Boolean(config),
          status: config?.status,
          message: options?.message ?? config?.message,
          data: options?.data,
          cause: options?.cause,
        })
      }

      return item
    },
  })

  return proxy as any
}

export async function validateORPCError(map: ErrorMap, error: ORPCError<any, any>): Promise<ORPCError<string, unknown>> {
  const { code, status, message, data, cause, defined } = error
  const config = map?.[error.code]

  if (!config || fallbackORPCErrorStatus(error.code, config.status) !== error.status) {
    return defined
      ? new ORPCError(code, { defined: false, status, message, data, cause })
      : error
  }

  if (!config.data) {
    return defined
      ? error
      : new ORPCError(code, { defined: true, status, message, data, cause })
  }

  const validated = await config.data['~standard'].validate(error.data)

  if (validated.issues) {
    return defined
      ? new ORPCError(code, { defined: false, status, message, data, cause })
      : error
  }

  return new ORPCError(code, { defined: true, status, message, data: validated.value, cause })
}
