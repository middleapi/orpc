import type { Client, NestedClient } from '@orpc/client'
import type { GeneralUtils } from './general-utils'
import type { ProcedureUtils } from './procedure-utils'
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from '@orpc/client'
import { isTypescriptObject } from '@orpc/shared'
import { createGeneralUtils } from './general-utils'
import { createProcedureUtils } from './procedure-utils'

export type RouterUtils<T extends NestedClient<any>>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? ProcedureUtils<UClientContext, UInput, UOutput, UError> & GeneralUtils<UInput>
    : {
      [K in keyof T]: T[K] extends NestedClient<any> ? RouterUtils<T[K]> : never
    } & GeneralUtils<unknown>

export interface CreateRouterUtilsOptions {
  path?: string[]
}

/**
 * Create a router utils from a client.
 *
 * @info Both client-side and server-side clients are supported.
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query-old/react Tanstack Query React Docs}
 */
export function createRouterUtils<T extends NestedClient<any>>(
  client: T,
  options: CreateRouterUtilsOptions = {},
): RouterUtils<T> {
  const path = options.path ?? []

  const generalUtils = createGeneralUtils(path)
  const procedureUtils = createProcedureUtils(client as any, { path })

  const recursive = new Proxy({
    ...generalUtils,
    ...procedureUtils,
  }, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      const nextClient = isTypescriptObject(client) ? Reflect.get(client, prop) : undefined

      if (typeof prop !== 'string' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(prop) || !isTypescriptObject(nextClient)) {
        return value
      }

      const nextUtils = createRouterUtils((client as any)[prop], { ...options, path: [...path, prop] })

      if (typeof value !== 'function') {
        return nextUtils
      }

      return new Proxy(value, {
        get(target, prop) {
          if (typeof prop !== 'string' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(prop)) {
            return Reflect.get(target, prop)
          }

          return Reflect.get(nextUtils, prop)
        },
      })
    },
  })

  return recursive as any
}
