import type { AnyNestedClient, InferClientContext, InferClientError } from '@orpc/client'

import type { RouterUtilsPlugin } from './plugin.ts'
import type { ProcedureUtilsOptions } from './procedure-utils.ts'
import { mergeProcedureUtilsOptions } from './procedure-utils.ts'

export interface StreamQuerySSRUtilsPluginOptions {
  /**
   * Whether utils run on the server, where streamed and live queries always settle at their first data.
   * Defaults to `true` when there is no global `window`, or in Deno.
   */
  isServer?: boolean | undefined
}

/**
 * Router utils plugin for SSR of streamed and live queries: sets `settleOnFirstData: true` on the server,
 * and `staleTime: 0` in the browser, so hydrated data is stale and its stream reopens when a component mounts.
 *
 * @see {@link https://orpc.dev/docs/integrations/pinia-colada#streamed-and-live-queries-in-ssr | Pinia Colada Integration - Streamed and Live Queries in SSR}
 */
export class StreamQuerySSRUtilsPlugin<
  T extends AnyNestedClient = AnyNestedClient,
> implements RouterUtilsPlugin<T> {
  readonly name = '~stream-query-ssr'

  private readonly defaults: { settleOnFirstData: true } | { staleTime: 0 }

  constructor(options: StreamQuerySSRUtilsPluginOptions = {}) {
    // the server always settles, even when observed, and keeps the staleTime so components sharing a query do not reopen it
    this.defaults =
      (options.isServer ?? (!('window' in globalThis) || 'Deno' in globalThis))
        ? { settleOnFirstData: true }
        : { staleTime: 0 }
  }

  initProcedureOptions(
    _path: string[],
    options: ProcedureUtilsOptions<InferClientContext<T>, any, any, InferClientError<T>>,
  ): ProcedureUtilsOptions<InferClientContext<T>, any, any, InferClientError<T>> {
    return mergeProcedureUtilsOptions<any, any, any, any>(
      {
        streamedOptions: this.defaults,
        liveOptions: this.defaults,
      },
      options,
    )
  }
}
