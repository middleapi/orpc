import type { Interceptor, MaybeOptionalOptions, ThrowableError } from '@orpc/shared'
import type { ToFetchResponseOptions } from '@orpc/standard-server-fetch'
import type { Context } from '../../context'
import type { StandardHandleOptions, StandardHandler } from '../standard'
import type { FriendlyStandardHandleOptions } from '../standard/utils'
import type { FetchHandlerPlugin } from './plugin'
import { intercept, resolveMaybeOptionalOptions, toArray } from '@orpc/shared'
import { toFetchResponse, toStandardLazyRequest } from '@orpc/standard-server-fetch'
import { resolveFriendlyStandardHandleOptions } from '../standard/utils'
import { CompositeFetchHandlerPlugin } from './plugin'

export type FetchHandleResult = { matched: true, response: Response } | { matched: false, response: undefined }

export interface FetchHandlerInterceptorOptions<T extends Context> extends StandardHandleOptions<T> {
  request: Request
  toFetchResponseOptions: ToFetchResponseOptions
}

export interface FetchHandlerOptions<T extends Context> extends ToFetchResponseOptions {
  adapterInterceptors?: Interceptor<FetchHandlerInterceptorOptions<T>, FetchHandleResult, ThrowableError>[]

  plugins?: FetchHandlerPlugin<T>[]
}

export class FetchHandler<T extends Context> {
  private readonly toFetchResponseOptions: ToFetchResponseOptions
  private readonly adapterInterceptors: Exclude<FetchHandlerOptions<T>['adapterInterceptors'], undefined>

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<FetchHandlerOptions<T>> = {},
  ) {
    const plugin = new CompositeFetchHandlerPlugin(options.plugins)

    plugin.initRuntimeAdapter(options)

    this.adapterInterceptors = toArray(options.adapterInterceptors)
    this.toFetchResponseOptions = options
  }

  async handle(
    request: Request,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandleOptions<T>>
  ): Promise<FetchHandleResult> {
    return intercept(
      this.adapterInterceptors,
      {
        ...resolveFriendlyStandardHandleOptions(resolveMaybeOptionalOptions(rest)),
        request,
        toFetchResponseOptions: this.toFetchResponseOptions,
      },
      async ({ request, toFetchResponseOptions, ...options }) => {
        const standardRequest = toStandardLazyRequest(request)

        const result = await this.standardHandler.handle(standardRequest, options)

        if (!result.matched) {
          return result
        }

        return {
          matched: true,
          response: toFetchResponse(result.response, toFetchResponseOptions),
        }
      },
    )
  }
}
