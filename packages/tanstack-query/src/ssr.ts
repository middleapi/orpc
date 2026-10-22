import type { AnyNestedClient, InferClientContext, InferClientError, RPCJsonSerialization } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { RouterUtilsPlugin } from './plugin'
import type { ProcedureUtilsOptions } from './procedure-utils'
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
      cancelStreamsOnFirstData: this.isServer,
      streamedOptions: { initialData: [], refetchOnMount: 'always' },
      liveOptions: { refetchOnMount: 'always' },
    }, options)
  }
}
