import type { HTTPPath } from '@orpc/contract'
import { standardizeHTTPPath } from '@orpc/openapi-client/standard'

export function toNestPattern(path: HTTPPath): string {
  return standardizeHTTPPath(path)
    .replace(/\/\{\+([^}]+)\}/g, '/*$1')
    .replace(/\/\{([^}]+)\}/g, '/:$1')
}
