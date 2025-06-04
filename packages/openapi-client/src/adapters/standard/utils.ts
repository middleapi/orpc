import type { HTTPPath } from '@orpc/client'

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
