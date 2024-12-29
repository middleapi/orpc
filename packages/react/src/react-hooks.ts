import type { ProcedureClient, RouterClient } from '@orpc/server'
import type { ORPCContext } from './react-context'
import { createGeneralHooks, type GeneralHooks } from './general-hooks'
import { orpcPathSymbol } from './orpc-path'
import { createProcedureHooks, type ProcedureHooks } from './procedure-hooks'

export type ORPCHooks<T extends RouterClient<any, any>> =
  T extends ProcedureClient<infer TInput, infer TOutput, any>
    ? ProcedureHooks<TInput, TOutput> & GeneralHooks<TInput, TOutput>
    : {
      [K in keyof T]: T[K] extends RouterClient<any, any> ? ORPCHooks<T[K]> : never
    } & GeneralHooks<unknown, unknown>

export interface CreateORPCHooksOptions<T extends RouterClient<any, any>> {
  context: ORPCContext<T>

  /**
   * The path of the router.
   *
   * @internal
   */
  path?: string[]
}

export function createORPCHooks<T extends RouterClient<any, any>>(
  options: CreateORPCHooksOptions<T>,
): ORPCHooks<T> {
  const path = options.path ?? []
  const generalHooks = createGeneralHooks({ context: options.context, path })

  const procedureHooks = createProcedureHooks({
    context: options.context,
    path,
  })

  return new Proxy(
    {
      [orpcPathSymbol]: path,

      ...generalHooks,
      ...procedureHooks,
    },
    {
      get(target, key) {
        const value = Reflect.get(target, key)

        if (typeof key !== 'string') {
          return value
        }

        const nextHooks = createORPCHooks({
          context: options.context,
          path: [...path, key],
        })

        if (typeof value !== 'function') {
          return nextHooks
        }

        return new Proxy(value, {
          get(_, key) {
            return Reflect.get(nextHooks, key)
          },
        })
      },
    },
  ) as any
}
