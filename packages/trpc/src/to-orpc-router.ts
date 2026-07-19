import type { AsyncIteratorClass } from '@orpc/shared'
import type { AnyProcedure, AnyRouter, inferRouterContext } from '@trpc/server'
import type { Parser, TrackedData } from '@trpc/server/unstable-core-do-not-import'
import * as ORPC from '@orpc/server'
import { isTypescriptObject, wrapAsyncIterator } from '@orpc/shared'
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
          object,
          never
      >
      : TRecord[K] extends Record<string, any>
        ? ToORPCRouterResult<TContext, TRecord[K]>
        : never
  }

/**
 * Convert a tRPC router to an oRPC router.
 */
export function toORPCRouter<T extends AnyRouter>(
  router: T,
): ToORPCRouterResult<
  inferRouterContext<T>,
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

    orpcRouter[key] = new ORPC.Lazy({
      meta: {},
      loader: async () => {
        const router = await item.ref()
        return { default: toORPCRouter(router) }
      },
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
    opaqueReturnedErrors: true,
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
          return wrapAsyncIterator(output[Symbol.asyncIterator](), {
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
