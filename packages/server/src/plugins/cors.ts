import type { Value } from '@orpc/shared'
import type { StandardHeaders } from '@orpc/standard-server'
import type { StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '../adapters/standard'
import type { Context } from '../context'
import { value } from '@orpc/shared'

export interface CORSOptions<T extends Context> {
  origin?: Value<string | readonly string[] | null | undefined, [origin: string, options: StandardHandlerInterceptorOptions<T>]>
  timingOrigin?: Value<string | readonly string[] | null | undefined, [origin: string, options: StandardHandlerInterceptorOptions<T>]>
  allowMethods?: readonly string[]
  allowHeaders?: readonly string[]
  maxAge?: number
  credentials?: boolean
  exposeHeaders?: readonly string[]
}

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
          resHeaders['access-control-allow-methods'] = this.options.allowMethods.join(',')
        }

        const allowHeaders = this.options.allowHeaders ?? interceptorOptions.request.headers['access-control-request-headers']

        if (Array.isArray(allowHeaders) && allowHeaders.length) {
          resHeaders['access-control-allow-headers'] = allowHeaders.join(',')
        }
        else if (typeof allowHeaders === 'string') {
          resHeaders['access-control-allow-headers'] = allowHeaders
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

      const origin = Array.isArray(interceptorOptions.request.headers.origin)
        ? interceptorOptions.request.headers.origin.join(',') // the array case is never happen, but we make it for type safety
        : interceptorOptions.request.headers.origin || ''

      const allowedOrigin = await value(this.options.origin, origin, interceptorOptions)
      const allowedOriginArr = Array.isArray(allowedOrigin) ? allowedOrigin : [allowedOrigin]

      if (allowedOriginArr.includes('*')) {
        result.response.headers['access-control-allow-origin'] = '*'
      }
      else {
        if (allowedOriginArr.includes(origin)) {
          result.response.headers['access-control-allow-origin'] = origin
        }

        result.response.headers.vary = interceptorOptions.request.headers.vary ?? 'origin'
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
        result.response.headers['access-control-expose-headers'] = this.options.exposeHeaders.join(',')
      }

      return result
    })
  }
}
