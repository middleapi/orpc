import type { HTTPPath } from '@orpc/client'
import { fallbackORPCErrorStatus } from '@orpc/client'
import { isObject } from '@orpc/shared'

/**
 * OpenAPIHandler v2 omits `status` from error JSON, so fill it in
 * (from `status`, or from the error code when omitted) to let v2 errors pass `isORPCErrorJson`.
 *
 * @internal
 */
export function fillORPCErrorJsonStatus(json: unknown, status?: number): unknown {
  if (!isObject(json) || json.status !== undefined || typeof json.code !== 'string') {
    return json
  }

  return { ...json, status: fallbackORPCErrorStatus(json.code, status) }
}

/**
 * @internal
 */
export function standardizeHTTPPath(path: HTTPPath): HTTPPath {
  return `/${path.replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '')}`
}

/**
 * @internal
 */
export function getDynamicParams(path: HTTPPath | undefined): { raw: string, name: string }[] | undefined {
  return path
    ? standardizeHTTPPath(path).match(/\/\{[^}]+\}/g)?.map(v => ({
        raw: v,
        name: v.match(/\{\+?([^}]+)\}/)![1]!,
      }))
    : undefined
}
