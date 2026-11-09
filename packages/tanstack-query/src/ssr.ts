import type {
  AnyNestedClient,
  InferClientContext,
  InferClientError,
  RPCJsonSerialization,
} from '@orpc/client'
import { RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import { environmentManager } from '@tanstack/query-core'

import type { RouterUtilsPlugin } from './plugin'
import type { ProcedureUtilsOptions } from './procedure-utils'
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
   * Whether utils run on the server, where streamed and live queries settle at their first data.
   * Defaults to TanStack Query's `environmentManager.isServer()`.
   */
  isServer?: boolean | undefined
}

/**
 * Router utils plugin for SSR of streamed and live queries: sets `.streamedOptions` and `.liveOptions` defaults
 * so they settle at their first data on the server, and reopen their stream on mount in the browser.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#streamed-and-live-queries | TanStack Query Integration - Streamed and Live Queries}
 */
export class StreamQuerySSRUtilsPlugin<
  T extends AnyNestedClient = AnyNestedClient,
> implements RouterUtilsPlugin<T> {
  readonly name = '~stream-query-ssr'

  constructor(private readonly options: StreamQuerySSRUtilsPluginOptions = {}) {}

  initProcedureOptions(
    _path: string[],
    options: ProcedureUtilsOptions<InferClientContext<T>, any, any, InferClientError<T>>,
  ): ProcedureUtilsOptions<InferClientContext<T>, any, any, InferClientError<T>> {
    // read when utils are built, so `environmentManager.setIsServer` applies even after the plugin is created
    const defaults =
      (this.options.isServer ?? environmentManager.isServer())
        ? // the render must finish even with observers (vue, svelte), which must not reopen the settled stream
          { settleOnFirstData: true, refetchOnMount: false }
        : // hydrated data reopens its stream on mount, despite a `staleTime`
          { refetchOnMount: 'always' as const }

    return mergeProcedureUtilsOptions<any, any, any, any>(
      { streamedOptions: defaults, liveOptions: defaults },
      options,
    )
  }
}
