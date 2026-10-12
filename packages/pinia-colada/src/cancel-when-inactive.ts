import type { UseQueryFnContext } from './types'
import { tryOrUndefined } from '@orpc/shared'
import { useQueryCache } from '@pinia/colada'

/**
 * Wraps a streaming query function so its fetch is cancelled once the query entry
 * loses its last consumer or is removed from the cache.
 *
 * Pinia Colada only aborts in-flight queries whose status is still `pending`, but streaming
 * query functions publish `success` states while the stream is open, so without this the
 * stream would stay open after every consumer is gone.
 */
export function cancelWhenInactive<T>(
  queryFn: (context: UseQueryFnContext) => Promise<T>,
): (context: UseQueryFnContext) => Promise<T> {
  return async (context) => {
    const { entry, signal } = context

    // Resolved before any `await`: Pinia Colada's `fetch` action only keeps the query's Pinia
    // active while it synchronously calls the query function
    const queryCache = tryOrUndefined(() => useQueryCache())

    if (!queryCache) {
      // No active Pinia: the query function is not run by Pinia Colada (e.g. called directly)
      return queryFn(context)
    }

    const unsubscribe = queryCache.$onAction(({ name, args, after }) => {
      if (args[0] === entry && (name === 'untrack' || name === 'remove')) {
        after(() => {
          // A newer fetch would have aborted this signal, so `entry.pending` still belongs to this fetch
          if (!signal.aborted && (name === 'remove' || !entry.active)) {
            queryCache.cancel(entry)
          }
        })
      }
    }, true) // detached: keep watching after the component that triggered the fetch unmounts

    try {
      return await queryFn(context)
    }
    finally {
      unsubscribe()
    }
  }
}
