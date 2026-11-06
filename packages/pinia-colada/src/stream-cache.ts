import type { PipeStreamToCacheOptions } from '@orpc/shared'
import { runWithOwnSignal } from '@orpc/shared'

import type { UseQueryFnContext } from './types.ts'

export interface SettleOnFirstDataOptions {
  /**
   * Settles the fetch at its first data (streamed: when the stream connects; live: on the first event)
   * instead of following the stream to its end. The stream is closed and the data kept.
   * The stream reopens on mount only once the entry is stale (e.g. with `staleTime: 0`, as `StreamQuerySSRUtilsPlugin` sets in the browser).
   * Use it only where nothing watches the stream, such as server rendering:
   * a refetch while a component uses the query would also settle, closing its stream.
   * @default false
   */
  settleOnFirstData?: boolean | undefined
}

export type StreamWrites<TData> = Required<
  Pick<PipeStreamToCacheOptions<unknown, TData>, 'signal' | 'update'>
> &
  Pick<PipeStreamToCacheOptions<unknown, TData>, 'settle'>

/**
 * Runs a fetch's stream against its entry, giving each call its own signal, aborted once its stream is no longer read.
 * A fetch aborted before it ends (cancelled, superseded, or its last component left) marks the entry stale,
 * so the stream reopens when a component uses it again.
 * @returns the data to resolve the fetch with, or `undefined` if nothing was written
 */
export async function followEntryStream<TData>(
  context: UseQueryFnContext,
  settleOnFirstData: SettleOnFirstDataOptions['settleOnFirstData'],
  run: (
    callContext: UseQueryFnContext,
    writes: StreamWrites<TData>,
  ) => Promise<{ data: TData } | undefined>,
): Promise<{ data: TData } | undefined> {
  const { entry, signal } = context

  signal.addEventListener(
    'abort',
    () => {
      entry.when = 0
    },
    { once: true },
  )

  const update: StreamWrites<TData>['update'] = (updater) => {
    const { status, data: current } = entry.state.value
    const data = updater(current as TData | undefined)

    // an unchanged write (e.g. 'append' at connect) is not new data
    if (data !== current || status !== 'success') {
      entry.state.value = { status: 'success', data, error: null } as any
    }
  }

  const result = await runWithOwnSignal(signal, (callSignal) =>
    run(
      { ...context, signal: callSignal },
      { signal, update, settle: settleOnFirstData ? () => true : undefined },
    ),
  )

  // Colada writes the returned data again, so return the entry data to keep later writes
  return result && { data: entry.state.value.data as TData }
}
