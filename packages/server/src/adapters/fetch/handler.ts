import type { Interceptor, MaybeOptionalOptions } from '@orpc/shared'
import type { ToFetchResponseOptions } from '@standardserver/fetch'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler, StandardHandlerHandleOptions } from '../standard'
import type { FetchHandlerPlugin } from './plugin'
import { intercept, resolveMaybeOptionalOptions } from '@orpc/shared'
import { toFetchResponse, toStandardLazyRequest } from '@standardserver/fetch'
import { resolveFriendlyStandardHandlerHandleOptions } from '../standard'
import { CompositeFetchHandlerPlugin } from './plugin'

export type FetchHandlerHandleResult = { matched: true, response: Response } | { matched: false, response?: undefined }

export interface FetchHandlerFetchInterceptorOptions<T extends Context> extends StandardHandlerHandleOptions<T> {
  request: Request
  toFetchResponseOptions: ToFetchResponseOptions | undefined
}
export type FetchHandlerFetchInterceptor<T extends Context> = Interceptor<FetchHandlerFetchInterceptorOptions<T>, Promise<FetchHandlerHandleResult>>

export interface FetchHandlerOptions<T extends Context> {
  /**
   * Custom options for `toFetchResponse`, used to map a `Standard Response` to a `Fetch Response`.
   */
  toFetchResponse?: ToFetchResponseOptions

  /**
   * Interceptors that run before the mapping between the Standard API and Fetch API,
   * useful for customizing the mapping behavior (e.g. extending the body parser).
   */
  fetchInterceptors?: FetchHandlerFetchInterceptor<T>[] | undefined

  plugins?: FetchHandlerPlugin<T>[] | undefined
}

export class FetchHandler<T extends Context> {
  private readonly toFetchResponseOptions: FetchHandlerOptions<T>['toFetchResponse']
  private readonly fetchInterceptors: FetchHandlerOptions<T>['fetchInterceptors']

  constructor(
    private readonly standardHandler: StandardHandler<T>,
    options: NoInfer<FetchHandlerOptions<T>> = {},
  ) {
    options = new CompositeFetchHandlerPlugin(options.plugins).initFetchHandlerOptions(options)

    this.fetchInterceptors = options.fetchInterceptors
    this.toFetchResponseOptions = options.toFetchResponse
  }

  async handle(
    request: Request,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<FetchHandlerHandleResult> {
    return intercept(
      this.fetchInterceptors,
      {
        ...resolveFriendlyStandardHandlerHandleOptions(resolveMaybeOptionalOptions(rest)),
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
