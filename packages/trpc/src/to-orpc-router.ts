import type { AsyncIteratorClass } from '@orpc/shared'
import type { AnyProcedure, AnyRouter, inferRouterContext } from '@trpc/server'
import type { Parser, TrackedData } from '@trpc/server/unstable-core-do-not-import'
import * as ORPC from '@orpc/server'
import { isTypescriptObject, set, wrapAsyncIterator } from '@orpc/shared'
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
          object
      >
      : TRecord[K] extends Record<string, any>
        ? ToORPCRouterResult<TContext, TRecord[K]>
        : never
  }

/**
 * Converts a tRPC router into an oRPC router that works with any oRPC feature.
 *
 * @remarks
 * **Note**: tRPC Error Formatting is not supported. A `TRPCError` you throw becomes an `ORPCError`
 * with the same code and message. Unexpected exceptions, which tRPC wraps as `INTERNAL_SERVER_ERROR`,
 * are masked like any other unknown error, with the original kept as `error.cause.cause`.
 *
 * @see {@link https://orpc.dev/docs/integrations/trpc | tRPC Integration}
 */
export function toORPCRouter<T extends AnyRouter>(
  router: T,
): ToORPCRouterResult<
  inferRouterContext<T>,
  T['_def']['record']
> {
  const result = recordToORPCRouterRecord(router._def.record)

  for (const [key, item] of Object.entries(router._def.lazy)) {
    set(result, key.split('.') as [string, ...string[]], new ORPC.Lazy({
      meta: {},
      loader: async () => {
        const router = await item.ref()
        return { default: toORPCRouter(router) }
      },
    }))
  }

  return result as any
}

function recordToORPCRouterRecord(records: AnyRouter['_def']['record']) {
  const orpcRouter: Record<string, any> = {}

  for (const key of Object.keys(records)) {
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
          // Only the raw input: tRPC merges `input` into the parsed input, so passing it would keep keys the schema strips
          getRawInput: async () => trpcInput,
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
            mapError: toORPCError,
          })
        }

        return output
      }
      catch (cause) {
        throw toORPCError(cause)
      }
    },
  })
}

/**
 * tRPC wraps unknown exceptions as `new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause })`,
 * which copies the cause's message. That message was never meant for clients.
 */
function isAutoWrappedTRPCError(error: TRPCError): boolean {
  return error.code === 'INTERNAL_SERVER_ERROR'
    && error.cause !== undefined
    && !(error.cause instanceof TRPCError)
    && error.message === error.cause.message
}

function toORPCError<T>(error: T): T | ORPC.ORPCError<string, undefined> {
  if (error instanceof TRPCError) {
    if (isAutoWrappedTRPCError(error)) {
      // default "Internal Server Error" message, original kept on the cause chain for logging
      return new ORPC.ORPCError('INTERNAL_SERVER_ERROR', { cause: error })
    }

    return new ORPC.ORPCError(error.code, {
      message: error.message,
      cause: error,
    })
  }

  return error
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
