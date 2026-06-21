import type { Promisable } from '@orpc/shared'
import type { QueryFunction, QueryFunctionContext, QueryKey } from '@tanstack/query-core'
import { stringifyJSON } from '@orpc/shared'

export function liveQuery<
  TQueryFnData = unknown,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryFn: (
    context: QueryFunctionContext<TQueryKey>,
  ) => Promisable<AsyncIterable<TQueryFnData>>,
): QueryFunction<TQueryFnData, TQueryKey> {
  return async (context) => {
    const stream = await queryFn(context)
    let last: { chunk: TQueryFnData } | undefined

    for await (const chunk of stream) {
      context.signal?.throwIfAborted()

      last = { chunk }
      context.client.setQueryData<TQueryFnData>(context.queryKey, chunk)
    }

    if (!last) {
      throw new TypeError(
        `Live query for ${stringifyJSON(context.queryKey)} did not yield any data. Ensure the query function returns an AsyncIterable with at least one chunk.`,
      )
    }

    return last.chunk
  }
}
