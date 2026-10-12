import type { QueryCache } from '@pinia/colada'
import type { UseQueryFnContext } from './types'
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

    // Must run before any `await`, while Pinia Colada's `fetch` action keeps the right Pinia active
    const queryCache = tryUseQueryCache()

    const unsubscribe = queryCache?.$onAction(({ name, args, after }) => {
      if (args[0] !== entry || signal.aborted) {
        return
      }

      if (name === 'untrack') {
        after(() => {
          // A newer fetch would have aborted this signal, so `entry.pending` still belongs to this fetch
          if (!entry.active && !signal.aborted) {
            queryCache.cancel(entry)
          }
        })
      }
      else if (name === 'remove') {
        queryCache.cancel(entry)
      }
    }, true) // detached: keep watching after the component that triggered the fetch unmounts

    try {
      return await queryFn(context)
    }
    finally {
      unsubscribe?.()
    }
  }
}

function tryUseQueryCache(): QueryCache | undefined {
  try {
    return useQueryCache()
  }
  catch {
    // No active Pinia: the query function is not run by Pinia Colada (e.g. called directly)
    return undefined
  }
}
