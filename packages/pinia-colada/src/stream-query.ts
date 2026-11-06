import type { Promisable } from '@orpc/shared'
import { throwIfAborted } from '@orpc/shared'

import type { UseQueryFnContext } from './types.ts'

export interface SerializableStreamedQueryOptions {
  /**
   * What a fetch does with existing data once its stream connects.
   * Until then the data stays, so an entry with data never returns to `pending`.
   *
   * - `'reset'`: the data becomes `[]`, then each chunk is appended.
   * - `'append'`: the data is kept (trimmed to `maxChunks`), and each chunk is appended.
   *
   * @default 'reset'
   */
  refetchMode?: 'append' | 'reset' | undefined

  /**
   * Limits the number of data chunks stored in the query result.
   * Older chunks are removed when the limit is reached.
   *
   * @default Number.POSITIVE_INFINITY (unlimited)
   */
  maxChunks?: number | undefined
}

export interface SettleOnFirstDataOptions {
  /**
   * Settles the fetch at its first data (streamed: when the stream connects; live: on the first event)
   * instead of following the stream to its end. The stream is closed and the data kept.
   * The stream reopens on mount only once the entry is stale (e.g. with `staleTime: 0`, as `StreamQuerySSRUtilsPlugin` sets in the browser).
   * Use it only where nothing watches the stream, such as server rendering:
   * a refetch while a component uses the query would also settle, closing its stream.
   *
   * @default false
   */
  settleOnFirstData?: boolean | undefined
}

/**
 * A Pinia Colada query function that accumulates streamed chunks into an array,
 * publishing each chunk to the cache entry as it arrives.
 *
 * Inspired by [TanStack Query streamedQuery](https://tanstack.com/query/latest/docs/reference/streamedQuery) where:
 * - Options are serializable
 * - The output is predictable
 */
export function serializableStreamedQuery<T>(
  queryFn: (context: UseQueryFnContext) => Promisable<AsyncIterable<T>>,
  {
    refetchMode = 'reset',
    maxChunks = Number.POSITIVE_INFINITY,
    settleOnFirstData = false,
  }: SerializableStreamedQueryOptions & SettleOnFirstDataOptions = {},
): (context: UseQueryFnContext) => Promise<T[]> {
  return async (context) => {
    const { entry, signal } = context
    const write = (data: T[]): T[] => {
      entry.state.value = { status: 'success', data, error: null } as any
      return data
    }

    // a fetch cut short (cancelled, superseded, or its last component left) reopens when used again
    const markStale = () => {
      entry.when = 0
    }
    if (signal.aborted) {
      markStale()
    }
    signal.addEventListener('abort', markStale, { once: true })

    const stream = await queryFn(context)

    // close without reading, so a generator the query no longer wants never starts
    if (signal.aborted) {
      await stream[Symbol.asyncIterator]().return?.()
      throw signal.reason
    }

    const current = entry.state.value.data as T[] | undefined
    let data = write(refetchMode === 'append' && current ? limitArraySize(current, maxChunks) : [])

    if (settleOnFirstData) {
      await stream[Symbol.asyncIterator]().return?.()
      return data
    }

    for await (const chunk of stream) {
      throwIfAborted(signal)

      // read the entry, so writes made during the stream are kept
      const current = (entry.state.value.data as T[] | undefined) ?? []
      data = write(limitArraySize([...current, chunk], maxChunks))
    }

    // a stream that ends on abort must not be stored as fresh data
    throwIfAborted(signal)

    // Colada writes the returned data again, so return the entry data to keep later writes
    const cached = entry.state.value.data as T[] | undefined
    return cached === undefined ? data : limitArraySize(cached, maxChunks)
  }
}

function limitArraySize<T>(items: T[], maxSize: number): T[] {
  if (items.length <= maxSize) {
    return items
  }

  return items.slice(items.length - maxSize)
}
