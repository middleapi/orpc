import type { AsyncIteratorClass } from '@orpc/shared'
import type { AnyProcedure, AnyRouter, inferRouterContext } from '@trpc/server'
import type { Parser, TrackedData } from '@trpc/server/unstable-core-do-not-import'
import { wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import * as ORPC from '@orpc/server'
import { getOrBind, isTypescriptObject } from '@orpc/shared'
import { isTrackedEnvelope, TRPCError } from '@trpc/server'
import { isAsyncIterable, isObject } from '@trpc/server/unstable-core-do-not-import'

export type ToORPCOutput<T>
  = T extends AsyncIterable<infer TData, infer TReturn, infer TNext>
    ? AsyncIteratorClass<TData, TReturn, TNext>
    : T

export type ToORPCRouterResult<TContext extends ORPC.Context, TRecord extends Record<string, any>>
  = {
    [K in keyof TRecord]:
    TRecord[K] extends AnyProcedure
      ? ORPC.Procedure<
        TContext,
          object,
          ORPC.Schema<TRecord[K]['_def']['$types']['input'], unknown>,
          ORPC.Schema<unknown, ToORPCOutput<TRecord[K]['_def']['$types']['output']>>,
          Record<never, never>,
          never
      >
      : TRecord[K] extends Record<string, any>
        ? ToORPCRouterResult<TContext, TRecord[K]>
        : never
  }

/**
 * Convert a tRPC router to an oRPC router.
 *
 * @warning For OpenAPI features, define OpenAPI metadata under the `'~openapi'` key
 * in your tRPC meta, e.g. via `toTRPCMeta(openapi({ ... }))`.
 */
export function toORPCRouter<T extends AnyRouter>(
  router: T,
): ToORPCRouterResult<
  inferRouterContext<T>,
  T['_def']['record']
> {
  const result = recordToORPCRouterRecord(router._def.record)

  for (const key in router._def.lazy) {
    const item = router._def.lazy[key]!

    const lazy = new ORPC.Lazy({
      meta: {},
      loader: async () => {
        const router = await item.ref()
        return { default: toORPCRouter(router) }
      },
    })

    /**
     * tRPC keys lazy routers by their dot-joined path relative to the router root,
     * e.g. `nested.lazy` when a lazy router lives inside a plain object record.
     */
    const segments = key.split('.')
    let parent: Record<string, any> = result

    for (const segment of segments.slice(0, -1)) {
      parent = parent[segment] ??= {}
    }

    parent[segments.at(-1)!] = createAccessibleLazyRouter(lazy)
  }

  return result as any
}

/**
 * Allows accessing procedures/routers behind a lazy router without unlazying it first,
 * since converted lazy routers are typed as plain (non-lazy) routers.
 */
function createAccessibleLazyRouter(lazy: ORPC.Lazy<any>): ORPC.Lazy<any> {
  return new Proxy(lazy, {
    get(target, key) {
      if (typeof key !== 'string' || key === '~orpc') {
        return getOrBind(target, key)
      }

      return createAccessibleLazyRouter(ORPC.getRouter(target, [key]))
    },
  })
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
  const inputSchema = toStandardSchema(procedure._def.inputs.at(-1))
  const outputSchema = toStandardSchema((procedure._def as any).output)

  return new ORPC.Procedure({
    errorMap: {},
    meta: (procedure._def.meta ?? {}) as ORPC.Meta,
    orderedMiddlewares: [],
    inputSchemas: inputSchema ? [inputSchema] : undefined,
    outputSchemas: outputSchema ? [outputSchema] : undefined,
    // tRPC procedure calling already validates the input/output
    disableInputValidation: true,
    disableOutputValidation: true,
    handler: async ({ context, signal, path, input, lastEventId }) => {
      try {
        const trpcInput = lastEventId !== undefined && (input === undefined || isObject(input))
          ? { ...input, lastEventId }
          : input

        const output = await procedure({
          ctx: context,
          signal,
          path: path.join('.'),
          type: procedure._def.type,
          input: trpcInput,
          getRawInput: () => trpcInput,
          // TODO: this should infer from context when using oRPC Batch Plugin
          batchIndex: 0,
        })

        if (isAsyncIterable(output)) {
          return wrapAsyncIteratorPreservingEventMeta(output[Symbol.asyncIterator](), {
            mapResult: (result) => {
              if (isTrackedEnvelope(result.value)) {
                const [id, data] = result.value

                return {
                  done: result.done,
                  value: ORPC.withEventMeta({
                    id,
                    data,
                  } satisfies TrackedData<unknown>, {
                    id,
                  }),
                }
              }

              return result
            },
          })
        }

        return output
      }
      catch (cause) {
        if (cause instanceof TRPCError) {
          throw new ORPC.ORPCError(cause.code, {
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
 * Ensures the parser is a standard schema before exposing it to oRPC,
 * so schemas remain usable for type inference and OpenAPI generation.
 */
function toStandardSchema(schema: undefined | Parser): undefined | ORPC.AnySchema {
  if (!isTypescriptObject(schema) || !('~standard' in schema) || !isTypescriptObject(schema['~standard'])) {
    return undefined
  }

  return schema as any
}
