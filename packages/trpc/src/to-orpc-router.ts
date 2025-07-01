import type { AnyProcedure, AnyRouter, inferRouterContext } from '@trpc/server'
import type { inferRouterMeta, Parser } from '@trpc/server/unstable-core-do-not-import'
import * as ORPC from '@orpc/server'
import { isTypescriptObject } from '@orpc/shared'
import { TRPCError } from '@trpc/server'
import { getHTTPStatusCodeFromError } from '@trpc/server/unstable-core-do-not-import'

export interface experimental_ORPCMeta extends ORPC.Route {

}

export type experimental_ToORPCRouterResult<TContext extends ORPC.Context, TMeta extends ORPC.Meta, TRecord extends Record<string, any>>
    = {
      [K in keyof TRecord]:
      TRecord[K] extends AnyProcedure
        ? ORPC.Procedure<
          TContext,
          object,
          ORPC.Schema<TRecord[K]['_def']['$types']['input'], unknown>,
          ORPC.Schema<unknown, TRecord[K]['_def']['$types']['output']>,
          object,
          TMeta
        >
        : TRecord[K] extends Record<string, any>
          ? experimental_ToORPCRouterResult<TContext, TMeta, TRecord[K]>
          : never
    }

/**
 * Convert a tRPC router to an oRPC router.
 *
 * @warning You should set the `meta` type to `ORPCMeta` when creating your tRPC builder, to ensure OpenAPI features work correctly.
 */
export function experimental_toORPCRouter<T extends AnyRouter>(
  router: T,
): experimental_ToORPCRouterResult<
    inferRouterContext<T>,
    inferRouterMeta<T>,
    T['_def']['record']
  > {
  const result = {
    ...lazyToORPCRouter(router._def.lazy),
    ...recordToORPCRouterRecord(router._def.record),
  }

  return result as any
}

function lazyToORPCRouter(lazies: AnyRouter['_def']['lazy']) {
  const orpcRouter: Record<string, any> = {}

  for (const key in lazies) {
    const item = lazies[key]!

    orpcRouter[key] = ORPC.lazy(async () => {
      const router = await item.ref()
      return { default: experimental_toORPCRouter(router) }
    })
  }

  return orpcRouter
}

function recordToORPCRouterRecord(records: AnyRouter['_def']['record']) {
  const orpcRouter: Record<string, any> = {}

  for (const key in records) {
    const item = records[key]

    if (typeof item === 'function') {
      orpcRouter[key] = toORPCProcedure(item)
    }
    else {
      orpcRouter[key] = recordToORPCRouterRecord(item)
    }
  }

  return orpcRouter
}

function toORPCProcedure(procedure: AnyProcedure) {
  return new ORPC.Procedure({
    errorMap: {},
    meta: procedure._def.meta ?? {},
    inputValidationIndex: 0,
    outputValidationIndex: 0,
    route: procedure._def.meta ?? {},
    middlewares: [],
    inputSchema: toDisabledStandardSchema(procedure._def.inputs.at(-1)),
    outputSchema: toDisabledStandardSchema((procedure as any)._def.output),
    handler: async ({ context, signal, path, input }) => {
      try {
        return await procedure({
          ctx: context,
          signal,
          path: path.join('.'),
          type: procedure._def.type,
          input,
          getRawInput: () => input,
        })
      }
      catch (cause) {
        if (cause instanceof TRPCError) {
          throw new ORPC.ORPCError(cause.code, {
            status: getHTTPStatusCodeFromError(cause),
            message: cause.message,
            cause,
          })
        }

        throw cause
      }
    },
  })
}

/**
 * Wraps a TRPC schema to disable validation in the ORPC context.
 * This is necessary because tRPC procedure calling already validates the input/output,
 */
function toDisabledStandardSchema(schema: undefined | Parser): undefined | ORPC.Schema<unknown, unknown> {
  if (!isTypescriptObject(schema) || !('~standard' in schema) || !isTypescriptObject(schema['~standard'])) {
    return undefined
  }

  return new Proxy(schema as any, {
    get: (target, prop) => {
      if (prop === '~standard') {
        return new Proxy(target['~standard'], {
          get: (target, prop) => {
            if (prop === 'validate') {
              return (value: any) => ({ value })
            }

            return Reflect.get(target, prop, target)
          },
        })
      }

      return Reflect.get(target, prop, target)
    },
  })
}
