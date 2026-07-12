import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders } from '@orpc/standard-server'
import type { StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import { value } from '@orpc/shared'
import { flattenHeader } from '@orpc/standard-server'

export interface CORSOptions<T extends Context> {
  origin?: Value<Promisable<string | readonly string[] | null | undefined>, [origin: string, options: StandardHandlerInterceptorOptions<T>]>
  timingOrigin?: Value<Promisable<string | readonly string[] | null | undefined>, [origin: string, options: StandardHandlerInterceptorOptions<T>]>
  allowMethods?: readonly string[]
  allowHeaders?: readonly string[]
  maxAge?: number
  credentials?: boolean
  exposeHeaders?: readonly string[]
}

/**
 * CORSPlugin is a plugin for oRPC that allows you to configure CORS for your API.
 *
 * @see {@link https://orpc.dev/docs/plugins/cors CORS Plugin Docs}
 */
export class CORSPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly options: CORSOptions<T>

  order = 9_000_000

  constructor(options: CORSOptions<T> = {}) {
    const defaults: CORSOptions<T> = {
      origin: origin => origin,
      allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
    }

    this.options = {
      ...defaults,
      ...options,
    }
  }

  init(options: StandardHandlerOptions<T>): void {
    options.rootInterceptors ??= []

    options.rootInterceptors.unshift(async (interceptorOptions) => {
      if (interceptorOptions.request.method === 'OPTIONS') {
        const resHeaders: StandardHeaders = {}

        if (this.options.maxAge !== undefined) {
          resHeaders['access-control-max-age'] = this.options.maxAge.toString()
        }

        if (this.options.allowMethods?.length) {
          resHeaders['access-control-allow-methods'] = flattenHeader(this.options.allowMethods)
        }

        const allowHeaders = this.options.allowHeaders ?? interceptorOptions.request.headers['access-control-request-headers']

        if (typeof allowHeaders === 'string' || allowHeaders?.length) {
          resHeaders['access-control-allow-headers'] = flattenHeader(allowHeaders)
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
    })

    options.rootInterceptors.unshift(async (interceptorOptions) => {
      const result = await interceptorOptions.next()

      if (!result.matched) {
        return result
      }

      const origin = flattenHeader(interceptorOptions.request.headers.origin) ?? ''

      const allowedOrigin = await value(this.options.origin, origin, interceptorOptions)
      const allowedOriginArr = Array.isArray(allowedOrigin) ? allowedOrigin : [allowedOrigin]

      if (allowedOriginArr.includes('*')) {
        result.response.headers['access-control-allow-origin'] = '*'
      }
      else {
        if (allowedOriginArr.includes(origin)) {
          result.response.headers['access-control-allow-origin'] = origin
        }

        const existingVary = flattenHeader(result.response.headers.vary)
        if (!existingVary?.split(',').some(v => v.trim().toLowerCase() === 'origin')) {
          result.response.headers.vary = existingVary ? `${existingVary}, Origin` : 'Origin'
        }
      }

      const allowedTimingOrigin = await value(this.options.timingOrigin, origin, interceptorOptions)
      const allowedTimingOriginArr = Array.isArray(allowedTimingOrigin) ? allowedTimingOrigin : [allowedTimingOrigin]

      if (allowedTimingOriginArr.includes('*')) {
        result.response.headers['timing-allow-origin'] = '*'
      }
      else if (allowedTimingOriginArr.includes(origin)) {
        result.response.headers['timing-allow-origin'] = origin
      }

      if (this.options.credentials) {
        result.response.headers['access-control-allow-credentials'] = 'true'
      }

      if (this.options.exposeHeaders?.length) {
        result.response.headers['access-control-expose-headers'] = flattenHeader(this.options.exposeHeaders)
      }

      return result
    })
  }
}
