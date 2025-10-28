import type { HTTPPath } from '@orpc/client'
import type { Meta } from '@orpc/contract'
import type { Interceptor } from '@orpc/shared'
import type { StandardLazyRequest, StandardResponse } from '@orpc/standard-server'
import type { Context } from '../../context'
import type { ProcedureClientInterceptorOptions } from '../../procedure-client'
import type { Router } from '../../router'
import type { StandardHandlerPlugin } from './plugin'
import type { StandardCodec, StandardMatcher } from './types'
import { ORPCError, toORPCError } from '@orpc/client'
import { asyncIteratorWithSpan, intercept, isAsyncIteratorObject, ORPC_NAME, runWithSpan, setSpanError, toArray } from '@orpc/shared'
import { flattenHeader } from '@orpc/standard-server'
import { createProcedureClient } from '../../procedure-client'
import { CompositeStandardHandlerPlugin } from './plugin'

export interface StandardHandleOptions<T extends Context> {
  prefix?: HTTPPath
  context: T
}

export type StandardHandleResult = { matched: true, response: StandardResponse } | { matched: false, response: undefined }

export interface StandardHandlerInterceptorOptions<T extends Context> extends StandardHandleOptions<T> {
  request: StandardLazyRequest
}

export interface StandardHandlerOptions<TContext extends Context> {
  plugins?: StandardHandlerPlugin<TContext>[]

  /**
   * Interceptors at the request level, helpful when you want catch errors
   */
  interceptors?: Interceptor<StandardHandlerInterceptorOptions<TContext>, Promise<StandardHandleResult>>[]

  /**
   * Interceptors at the root level, helpful when you want override the request/response
   */
  rootInterceptors?: Interceptor<StandardHandlerInterceptorOptions<TContext>, Promise<StandardHandleResult>>[]

  /**
   *
   * Interceptors for procedure client.
   */
  clientInterceptors?: Interceptor<
    ProcedureClientInterceptorOptions<TContext, Record<never, never>, Meta>,
    Promise<unknown>
  >[]
}

export class StandardHandler<T extends Context> {
  private readonly interceptors: Exclude<StandardHandlerOptions<T>['interceptors'], undefined>
  private readonly clientInterceptors: Exclude<StandardHandlerOptions<T>['clientInterceptors'], undefined>
  private readonly rootInterceptors: Exclude<StandardHandlerOptions<T>['rootInterceptors'], undefined>

  constructor(
    router: Router<any, T>,
    private readonly matcher: StandardMatcher,
    private readonly codec: StandardCodec,
    options: NoInfer<StandardHandlerOptions<T>>,
  ) {
    const plugins = new CompositeStandardHandlerPlugin(options.plugins)

    plugins.init(options, router)

    this.interceptors = toArray(options.interceptors)
    this.clientInterceptors = toArray(options.clientInterceptors)
    this.rootInterceptors = toArray(options.rootInterceptors)

    this.matcher.init(router)
  }

  async handle(request: StandardLazyRequest, options: StandardHandleOptions<T>): Promise<StandardHandleResult> {
    const prefix = (options.prefix?.replace(/\/$/, '') || undefined) as HTTPPath | undefined

    if (prefix && !request.url.pathname.startsWith(`${prefix}/`) && request.url.pathname !== prefix) {
      return { matched: false, response: undefined }
    }

    return intercept(
      this.rootInterceptors,
      { ...options, request, prefix },
      async (interceptorOptions) => {
        return runWithSpan(
          { name: `${request.method} ${request.url.pathname}` },
          async (span) => {
            let step: 'decode_input' | 'call_procedure' | undefined

            try {
              return await intercept(
                this.interceptors,
                interceptorOptions,
                async ({ request, context, prefix }) => {
                  const method = request.method
                  const url = request.url

                  const pathname = prefix
                    ? url.pathname.replace(prefix, '')
                    : url.pathname

                  const match = await runWithSpan(
                    { name: 'find_procedure' },
                    () => this.matcher.match(method, `/${pathname.replace(/^\/|\/$/g, '')}`),
                  )

                  if (!match) {
                    return { matched: false as const, response: undefined }
                  }

                  /**
                   * [Semantic conventions for RPC spans](https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/)
                   */
                  span?.updateName(`${ORPC_NAME}.${match.path.join('/')}`)
                  span?.setAttribute('rpc.system', ORPC_NAME)
                  span?.setAttribute('rpc.method', match.path.join('.'))

                  step = 'decode_input'
                  let input = await runWithSpan(
                    { name: 'decode_input' },
                    () => this.codec.decode(request, match.params, match.procedure),
                  )
                  step = undefined

                  if (isAsyncIteratorObject(input)) {
                    input = asyncIteratorWithSpan(
                      { name: 'consume_event_iterator_input', signal: request.signal },
                      input,
                    )
                  }

                  const client = createProcedureClient(match.procedure, {
                    context,
                    path: match.path,
                    interceptors: this.clientInterceptors,
                  })

                  /**
                   * No need to use runWithSpan here, because the client already has its own span.
                   */
                  step = 'call_procedure'
                  const output = await client(input, {
                    signal: request.signal,
                    lastEventId: flattenHeader(request.headers['last-event-id']),
                  })
                  step = undefined

                  const response = this.codec.encode(output, match.procedure)

                  return {
                    matched: true,
                    response,
                  }
                },
              )
            }
            catch (e) {
            /**
             * Only errors that happen outside of the `call_procedure` step should be set as an error.
             * Because a business logic error should not be considered as a protocol-level error.
             */
              if (step !== 'call_procedure') {
                setSpanError(span, e)
              }

              const error = step === 'decode_input' && !(e instanceof ORPCError)
                ? new ORPCError('BAD_REQUEST', {
                    message: `Malformed request. Ensure the request body is properly formatted and the 'Content-Type' header is set correctly.`,
                    cause: e,
                  })
                : toORPCError(e)

              const response = this.codec.encodeError(error)

              return {
                matched: true,
                response,
              }
            }
          },
        )
      },
    )
  }
}
