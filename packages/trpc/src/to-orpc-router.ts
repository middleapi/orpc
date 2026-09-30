import type { AnyProcedure, AnyRouter, inferRouterContext } from '@trpc/server'
import type { Observable, Unsubscribable } from '@trpc/server/observable'
import type { LegacyObservableSubscriptionProcedure, Parser, TrackedData } from '@trpc/server/unstable-core-do-not-import'
import * as ORPC from '@orpc/server'
import { AsyncIteratorClass, isTypescriptObject, set, wrapAsyncIterator } from '@orpc/shared'
import { isTrackedEnvelope, TRPCError } from '@trpc/server'
import { isObservable } from '@trpc/server/observable'
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
          ORPC.Schema<unknown, TRecord[K] extends LegacyObservableSubscriptionProcedure<any>
            ? AsyncIteratorClass<TRecord[K]['_def']['$types']['output'], void, void>
            : ToORPCOutput<TRecord[K]['_def']['$types']['output']>>,
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
 * **Note**: tRPC Error Formatting is not supported — errors thrown by tRPC are wrapped in `ORPCError`.
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

        const result = await procedure({
          ctx: context,
          signal,
          path: path.join('.'),
          type: procedure._def.type,
          // Only the raw input: tRPC merges `input` into the parsed input, so passing it would keep keys the schema strips
          getRawInput: async () => trpcInput,
          // TODO: this should infer from context when using oRPC Batch Plugin
          batchIndex: 0,
        })

        // Legacy `observable(...)` subscriptions are streamed like async iterables, as tRPC does
        const output = procedure._def.type === 'subscription' && isObservable(result)
          ? observableToAsyncIterator(result, signal)
          : result

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

/**
 * Converts a tRPC observable into an async iterator, like tRPC's `observableToAsyncIterable`:
 * values emitted before they are pulled are buffered, an error is thrown once they are consumed,
 * and cancelling the iterator or aborting `signal` unsubscribes. It subscribes on the first pull,
 * so an iterator that is never consumed holds no subscription.
 */
function observableToAsyncIterator<T>(
  observable: Observable<T, unknown>,
  signal: AbortSignal | undefined,
): AsyncIteratorClass<T, void, void> {
  const values: T[] = []
  let end: { kind: 'complete' } | { kind: 'error', error: unknown } | undefined
  let subscription: Unsubscribable | undefined
  let wakeUp: (() => void) | undefined

  function stop(reason: Exclude<typeof end, undefined>) {
    end ??= reason
    signal?.removeEventListener('abort', onAbort)
    subscription?.unsubscribe()
    wakeUp?.()
  }

  function onAbort() {
    stop({ kind: 'complete' })
  }

  return new AsyncIteratorClass<T, void, void>(async () => {
    if (subscription === undefined && end === undefined) {
      if (signal?.aborted) {
        end = { kind: 'complete' }
      }
      else {
        signal?.addEventListener('abort', onAbort, { once: true })

        subscription = observable.subscribe({
          next: (value) => {
            if (end === undefined) {
              values.push(value)
              wakeUp?.()
            }
          },
          error: error => stop({ kind: 'error', error }),
          complete: () => stop({ kind: 'complete' }),
        })
      }
    }

    while (true) {
      if (values.length > 0) {
        // `T` itself may include `undefined`, so the value is not narrowed with `!`
        return { done: false, value: values.shift() as T }
      }

      if (end?.kind === 'error') {
        throw end.error
      }

      if (end !== undefined) {
        return { done: true, value: undefined }
      }

      await new Promise<void>((resolve) => {
        wakeUp = resolve
      })

      wakeUp = undefined
    }
  }, async () => stop({ kind: 'complete' }))
}
