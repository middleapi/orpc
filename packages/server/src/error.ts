import type { ORPCErrorCode, ORPCErrorOptions } from '@orpc/client'
import type { ErrorMap, ErrorMapItem, InferSchemaInput } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import { fallbackORPCErrorStatus, ORPCError } from '@orpc/client'

export type ORPCErrorConstructorMapItemOptions<TData> = Omit<ORPCErrorOptions<TData>, 'defined' | 'status'>

export type ORPCErrorConstructorMapItem<TCode extends ORPCErrorCode, TInData>
  = (...rest: MaybeOptionalOptions<ORPCErrorConstructorMapItemOptions<TInData>>) => ORPCError<TCode, TInData>

export type ORPCErrorConstructorMap<T extends ErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<infer UInputSchema>
      ? ORPCErrorConstructorMapItem<K, InferSchemaInput<UInputSchema>>
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
