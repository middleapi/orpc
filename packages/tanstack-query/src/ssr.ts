import type { AnyNestedClient, InferClientContext, InferClientError, RPCJsonSerialization } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { RouterUtilsPlugin } from './plugin'
import type { ProcedureUtilsOptions, ProcedureUtilsQueryInterceptor } from './procedure-utils'
import { RPCJsonSerializer } from '@orpc/client'
import { mergeProcedureUtilsOptions } from './procedure-utils'

/**
 * Creates `dehydrate` and `hydrate` query client defaults that preserve oRPC types.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#custom-serializers | TanStack Query Integration - Custom Serializers}
 */
export function createHydrationOptions(
  serializer: Public<RPCJsonSerializer> = new RPCJsonSerializer(),
): {
  dehydrate: { serializeData: (data: unknown) => RPCJsonSerialization }
  hydrate: { deserializeData: (data: RPCJsonSerialization) => unknown }
} {
  return {
    dehydrate: {
      serializeData(data) {
        const { json, meta } = serializer.serializeJson(data)
        return { json, meta }
      },
    },
    hydrate: {
      deserializeData(data) {
        return serializer.deserializeJson(data)
      },
    },
  }
}

export interface StreamQuerySSRUtilsPluginOptions {
  /**
   * Whether utils run on the server, where streamed and live queries are cancelled once they have data.
   * Defaults to `true` when there is no global `window`.
   */
  isServer?: boolean | undefined
}

/**
 * Cancels the query once it has data, keeping that data. The cancel aborts the call's `signal`.
 */
const cancelOnFirstData: ProcedureUtilsQueryInterceptor<any, any, any, any> = async ({ next, fnContext }) => {
  const cache = fnContext.client.getQueryCache()
  const query = cache.find({ queryKey: fnContext.queryKey, exact: true })

  const unsubscribe = cache.subscribe((event) => {
    if (event.query === query && event.type === 'updated' && event.action.type === 'success') {
      unsubscribe()
      void event.query.cancel({ revert: true })
    }
  })

  try {
    return await next()
  }
  finally {
    unsubscribe()
  }
}

/**
 * Router utils plugin for SSR of streamed and live queries. On the server, streamed queries are
 * cancelled once they connect and live queries on their first event, keeping the data received so far;
 * in the browser, they refetch on mount so streams reopen after hydration.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#streamed-and-live-queries | TanStack Query Integration - Streamed and Live Queries}
 */
export class StreamQuerySSRUtilsPlugin<T extends AnyNestedClient = AnyNestedClient> implements RouterUtilsPlugin<T> {
  readonly name = '~stream-query-ssr'

  private readonly isServer: boolean

  constructor(options: StreamQuerySSRUtilsPluginOptions = {}) {
    this.isServer = options.isServer ?? !('window' in globalThis)
  }

  initProcedureOptions(
    _path: string[],
    options: ProcedureUtilsOptions<InferClientContext<T>, any, any, InferClientError<T>>,
  ): ProcedureUtilsOptions<InferClientContext<T>, any, any, InferClientError<T>> {
    return mergeProcedureUtilsOptions<any, any, any, any>({
      ...this.isServer ? { streamedInterceptors: [cancelOnFirstData], liveInterceptors: [cancelOnFirstData] } : {},
      streamedOptions: { initialData: [], refetchOnMount: 'always' },
      liveOptions: { refetchOnMount: 'always' },
    }, options)
  }
}
