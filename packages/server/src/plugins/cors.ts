import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders } from '@standardserver/core'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '../adapters/standard'
import type { Context } from '../context'
import { toArray, value } from '@orpc/shared'
import { flattenStandardHeader } from '@standardserver/core'

export interface CORSHandlerPluginOptions<T extends Context> {
  /**
   * Configures the `Access-Control-Allow-Origin` header.
   * Can be a string, an array of allowed origins, or a function that returns the allowed origin(s).
   *
   * @default (origin) => origin
   */
  origin?: Value<Promisable<string | readonly string[] | null | undefined>, [origin: string, options: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Configures the `Timing-Allow-Origin` header.
   * Can be a string, an array of allowed origins, or a function that returns the allowed origin(s).
   *
   * @default undefined
   */
  timingOrigin?: Value<Promisable<string | readonly string[] | null | undefined>, [origin: string, options: StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Configures the `Access-Control-Allow-Methods` header for preflight requests.
   *
   * @default ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH']
   */
  allowMethods?: readonly string[]

  /**
   * Configures the `Access-Control-Allow-Headers` header for preflight requests.
   * Falls back to the request's `Access-Control-Request-Headers` if not set.
   *
   * @default undefined
   */
  allowHeaders?: readonly string[]

  /**
   * Configures the `Access-Control-Max-Age` header (in seconds) for preflight requests.
   *
   * @default undefined
   */
  maxAge?: number

  /**
   * Configures the `Access-Control-Allow-Credentials` header.
   *
   * @default undefined
   */
  credentials?: boolean

  /**
   * Configures the `Access-Control-Expose-Headers` header.
   *
   * @default undefined
   */
  exposeHeaders?: readonly string[]
}

/**
 * CORSHandlerPlugin is a plugin for oRPC that allows you to configure CORS for your API.
 *
 * @see {@link https://orpc.dev/docs/plugins/cors CORS Plugin Docs}
 */
export class CORSHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly options: CORSHandlerPluginOptions<T>

  name = '~cors'

  /**
   * - Do not create spans for CORS preflight requests.
   * - Run CORS interceptors before batch interceptors so headers are applied to
   *  the actual response rather than sub-responses.
   */
  after = ['~opentelemetry', '~batch']

  constructor(options: CORSHandlerPluginOptions<T> = {}) {
    const defaults: CORSHandlerPluginOptions<T> = {
      origin: origin => origin,
      allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
    }

    this.options = {
      ...defaults,
      ...options,
    }
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const corsHeadersInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      const result = await interceptorOptions.next()

      if (!result.matched) {
        return result
      }

      const resHeaders = { ...result.response.headers }

      const origin = flattenStandardHeader(interceptorOptions.request.headers.origin) ?? ''

      const allowedOrigins = toArray(await value(this.options.origin, origin, interceptorOptions))

      if (allowedOrigins.includes('*')) {
        resHeaders['access-control-allow-origin'] = '*'
      }
      else {
        if (allowedOrigins.includes(origin)) {
          resHeaders['access-control-allow-origin'] = origin
        }

        const existingVary = flattenStandardHeader(resHeaders.vary)
        if (!existingVary?.split(',').some(v => v.trim().toLocaleLowerCase() === 'origin')) {
          resHeaders.vary = existingVary ? `${existingVary}, Origin` : 'Origin'
        }
      }

      const allowedTimingOrigins = toArray(await value(this.options.timingOrigin, origin, interceptorOptions))

      if (allowedTimingOrigins.includes('*')) {
        resHeaders['timing-allow-origin'] = '*'
      }
      else if (allowedTimingOrigins.includes(origin)) {
        resHeaders['timing-allow-origin'] = origin
      }

      if (this.options.credentials) {
        resHeaders['access-control-allow-credentials'] = 'true'
      }

      if (this.options.exposeHeaders?.length) {
        resHeaders['access-control-expose-headers'] = flattenStandardHeader(this.options.exposeHeaders)
      }

      return { ...result, response: { ...result.response, headers: resHeaders } }
    }

    const preflightInterceptor: StandardHandlerRoutingInterceptor<T> = async (interceptorOptions) => {
      if (interceptorOptions.request.method === 'OPTIONS') {
        const resHeaders: StandardHeaders = {}

        if (this.options.maxAge !== undefined) {
          resHeaders['access-control-max-age'] = this.options.maxAge.toString()
        }

        if (this.options.allowMethods?.length) {
          resHeaders['access-control-allow-methods'] = flattenStandardHeader(this.options.allowMethods)
        }

        const allowHeaders = this.options.allowHeaders ?? interceptorOptions.request.headers['access-control-request-headers']

        if (typeof allowHeaders === 'string' || allowHeaders?.length) {
          resHeaders['access-control-allow-headers'] = flattenStandardHeader(allowHeaders)
        }

        return {
          matched: true,
          response: {
            status: 204,
            headers: resHeaders,
            body: undefined,
          },
        }
      }

      return interceptorOptions.next()
    }

    return {
      ...options,
      routingInterceptors: [
        corsHeadersInterceptor,
        preflightInterceptor,
        ...toArray(options.routingInterceptors),
      ],
    }
  }
}
