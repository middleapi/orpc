import type { PipeStreamToCacheOptions } from '@orpc/shared'
import { runWithOwnSignal } from '@orpc/shared'
import type { Query, QueryCache, QueryFunctionContext } from '@tanstack/query-core'

export interface SettleOnFirstDataOptions {
  /**
   * Settles the fetch at its first data (streamed: when the stream connects; live: on the first event)
   * instead of following the stream to its end. The stream is closed and the data kept, marked stale,
   * so the stream reopens on the next fetch (e.g. refetch on mount).
   * Use it only where nothing watches the stream, such as server rendering:
   * a refetch while a query is mounted would also settle, closing its stream.
   * @default false
   */
  settleOnFirstData?: boolean | undefined
}

// retries call the query function again with the same signal
const trackedSignals = /* @__PURE__ */ new WeakSet<AbortSignal>()

export type StreamWrites<TData> = Required<
  Pick<PipeStreamToCacheOptions<unknown, TData>, 'signal' | 'update'>
> &
  Pick<PipeStreamToCacheOptions<unknown, TData>, 'settle'>

/**
 * Runs a fetch's stream against the fetch's own query (so a custom `queryKeyHashFn` is respected),
 * giving each call its own signal, aborted once its stream is no longer read.
 * - A stream cut short (cancelled, or its last observer left) marks the query stale.
 * - A settled fetch is marked stale once stored, so its stream reopens when observed.
 * @returns the data to resolve the fetch with, or `undefined` if nothing was written
 */
export async function followStream<TContext extends QueryFunctionContext<any>, TData>(
  context: TContext,
  settleOnFirstData: SettleOnFirstDataOptions['settleOnFirstData'],
  run: (callContext: TContext, writes: StreamWrites<TData>) => Promise<{ data: TData } | undefined>,
): Promise<{ data: TData } | undefined> {
  const queryCache = context.client.getQueryCache()
  let query: Query<any, any, any, any> | undefined
  const findQuery = () => (query ??= queryCache.find({ queryKey: context.queryKey, exact: true }))

  if (!trackedSignals.has(context.signal)) {
    trackedSignals.add(context.signal)
    context.signal.addEventListener('abort', () => findQuery()?.invalidate(), { once: true })
  }

  const update: StreamWrites<TData>['update'] = (updater) => {
    const query = findQuery()

    if (!query) {
      context.client.setQueryData<TData>(context.queryKey, updater as any)
      return
    }

    const current = query.state.data
    const data = updater(current)

    // an unchanged write (e.g. 'append' at connect) is not new data
    if (data !== current) {
      query.setData(data, { manual: true })
    }
  }

  let settled = false
  const settle = settleOnFirstData ? () => (settled = findQuery() !== undefined) : undefined

  const result = await runWithOwnSignal(context.signal, (signal) =>
    run({ ...context, signal }, { signal: context.signal, update, settle }),
  )

  if (settled) {
    invalidateOnceStored(queryCache, findQuery()!, context.signal)
  }

  if (!result) {
    return undefined
  }

  // the returned data is written again, so return the cache to keep later writes
  const cached = findQuery()?.state.data as TData | undefined
  return { data: cached === undefined ? result.data : cached }
}

function invalidateOnceStored(
  queryCache: QueryCache,
  query: Query<any, any, any, any>,
  signal: AbortSignal,
): void {
  const unsubscribe = queryCache.subscribe((event) => {
    if (event.query !== query || event.type !== 'updated') {
      return
    }

    if (event.action.type === 'error' || event.action.type === 'failed') {
      unsubscribe()
    } else if (event.action.type === 'success' && !event.action.manual) {
      unsubscribe()
      query.invalidate()
    }
  })

  // a fetch cancelled before it is stored (e.g. by a refetch) must not invalidate the next one
  signal.addEventListener('abort', unsubscribe, { once: true })
}
