import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import { createContractProcedure, getRouter, Procedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, pathToHttpPath, safeDecodeURIComponent, safeEncodeURIComponent, value } from '@orpc/shared'
import { addRoute, createRouter, findRoute, routeToRegExp } from 'rou3'
import { DEFAULT_OPENAPI_METHOD } from '../../constants'
import { getOpenAPIMeta } from '../../meta'
import { getDynamicPathParams, validateDynamicPathParams } from '../../utils'

export interface OpenAPIMatcherOptions {
  /**
   * Filter which procedures are exposed for matching. Return `false` to exclude.
   *
   * @default true
   */
  filter?: Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]>
}

interface TreeEntry {
  path: string[]
  contract: AnyProcedureContract
  procedure?: AnyProcedure | undefined
}

interface PendingLazyRouter extends WalkProcedureContractsLazyResult {
  matcher?: RegExp
  /** in-flight load, shared so concurrent matches never load or re-index the same router twice */
  loading?: Promise<void> | undefined
}

export class OpenAPIMatcher {
  private readonly filter: Exclude<OpenAPIMatcherOptions['filter'], undefined>
  private readonly rootRouter: AnyRouter

  private readonly tree = createRouter<TreeEntry>()
  private readonly pendingLazyRouters: Set<PendingLazyRouter> = new Set()

  constructor(router: AnyRouter, options: OpenAPIMatcherOptions = {}) {
    this.filter = options.filter ?? true
    this.rootRouter = router
    this.index(router)
  }

  private index(router: AnyRouter, path: string[] = []): void {
    const lazyResults = walkProcedureContractsSync(router, (contract, path) => {
      if (!value(this.filter, contract, path)) {
        return
      }

      const meta = getOpenAPIMeta(contract)
      const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
      const postHttpPath = meta?.path ?? pathToHttpPath(path)
      const openapiPath = meta?.prefix ? mergeHttpPath(meta.prefix, postHttpPath) : postHttpPath
      const params = getDynamicPathParams(openapiPath)

      const invalidReason = validateDynamicPathParams(openapiPath, params)
      if (invalidReason !== undefined) {
        throw new TypeError(`[OpenAPIMatcher] Invalid OpenAPI path for procedure at path: "${path.join('.')}". ${invalidReason}`)
      }

      const rou3Path = toRou3Pattern(openapiPath, params)

      addRoute(this.tree, method, rou3Path, {
        path,
        contract,
        procedure: contract instanceof Procedure ? contract : undefined,
      })
    }, path)

    for (const result of lazyResults) {
      const prefix = getOpenAPIMeta(result.router)?.prefix

      this.pendingLazyRouters.add({
        ...result,
        matcher: prefix ? toRou3PrefixMatcher(prefix) : undefined,
      })
    }
  }

  async match(
    method: string,
    pathname: `/${string}`,
    prefix: `/${string}` | undefined,
  ): Promise<{ path: string[], procedure: AnyProcedure, params?: Record<string, string> | undefined } | undefined> {
    // rou3 handles trailing slash removal automatically
    // if (pathname.length > 1 && pathname.endsWith('/')) {
    //   pathname = pathname.slice(0, -1) as `/${string}`
    // }

    if (prefix) {
      if (!pathname.startsWith(prefix)) {
        return undefined
      }

      const charAfterPrefix = pathname[prefix.length]

      if (charAfterPrefix === '/') {
        pathname = pathname.slice(prefix.length) as `/${string}`
      }
      else if (charAfterPrefix === undefined) {
        pathname = '/'
      }
      else if (prefix[prefix.length - 1] === '/') {
        pathname = pathname.slice(prefix.length - 1) as `/${string}`
      }
      else {
        return undefined
      }
    }

    // Routes are stored in canonical form, so requests that encode the same path differently
    // (e.g. "a%62c" vs "abc", or "users:batchGet" vs "users%3AbatchGet") match the same entry.
    pathname = toCanonicalPath(pathname)

    // most requests `await undefined` so conditionally await it to save a microtask turn
    const loading = this.resolvePendingLazyRouters(pathname)
    if (loading !== undefined) {
      await loading
    }

    const match = findRoute(this.tree, method, pathname)

    if (match === undefined) {
      return undefined
    }

    const entry = match.data

    return {
      path: entry.path,
      procedure: entry.procedure ?? await this.resolveProcedure(entry),
      params: match.params ? decodeParams(match.params) : undefined,
    }
  }

  private resolvePendingLazyRouters(pathname: `/${string}`): Promise<void> | void {
    for (const pending of this.pendingLazyRouters) {
      if (pending.matcher === undefined || pending.matcher.test(pathname)) {
        return this.loadPendingLazyRouters(pathname)
      }
    }
  }

  private async loadPendingLazyRouters(pathname: `/${string}`): Promise<void> {
    for (const pending of this.pendingLazyRouters) {
      if (pending.matcher === undefined || pending.matcher.test(pathname)) {
        await this.loadPendingLazyRouter(pending)
      }
    }
  }

  private loadPendingLazyRouter(pending: PendingLazyRouter): Promise<void> {
    if (pending.loading === undefined) {
      pending.loading = this.indexPendingLazyRouter(pending).catch((error) => {
        pending.loading = undefined
        throw error
      })
    }

    return pending.loading
  }

  private async indexPendingLazyRouter(pending: PendingLazyRouter): Promise<void> {
    const { default: router } = await unlazy(pending.router)

    this.index(router, pending.path)

    // removed only once indexed, so a concurrent match never observes this router as
    // neither pending nor indexed
    this.pendingLazyRouters.delete(pending)
  }

  private async resolveProcedure(entry: TreeEntry): Promise<AnyProcedure> {
    const { default: maybeProcedure } = await unlazy(getRouter(this.rootRouter, entry.path))

    if (!(maybeProcedure instanceof Procedure)) {
      throw new TypeError(
        `[Contract-First] Missing or invalid implementation for procedure at path: "${entry.path.join('.')}". `
        + `Ensure the procedure is correctly implemented and matches its contract.`,
      )
    }

    entry.procedure = createContractProcedure(maybeProcedure, entry.contract)

    return entry.procedure
  }
}

/**
 * Static segments are stored in canonical form, which never contains rou3 syntax
 * (`:`, `*`, `(`, `)`, `{`, `}`), so literal text in a path cannot be read as a pattern.
 */
function toRou3Pattern(
  path: `/${string}`,
  params: ReturnType<typeof getDynamicPathParams> = getDynamicPathParams(path),
): `/${string}` {
  let pattern = ''
  let index = 0

  for (const param of params ?? []) {
    pattern += toCanonicalPath(path.slice(index, param.startIndex))
    pattern += param.allowsSlash ? `**:${param.parameterName}` : `:${param.parameterName}`
    index = param.startIndex + param.segment.length
  }

  pattern += toCanonicalPath(path.slice(index))

  return pattern as `/${string}`
}

/**
 * Paths made only of these characters are already canonical, so most requests skip the work below.
 */
const CANONICAL_PATH_REGEX = /^[\w\-.!~'/]*$/

/**
 * Characters `encodeURIComponent` keeps as is but rou3 reads as pattern syntax.
 */
const ROU3_SYNTAX_REGEX = /[*()]/g

/**
 * Decode then re-encode every segment the same way {@link pathToHttpPath} does, and also
 * percent-encode the characters rou3 would read as pattern syntax.
 */
function toCanonicalPath<T extends string>(path: T): T {
  if (CANONICAL_PATH_REGEX.test(path)) {
    return path
  }

  return path
    .split('/')
    .map(segment => safeEncodeURIComponent(safeDecodeURIComponent(segment)))
    .join('/')
    .replace(ROU3_SYNTAX_REGEX, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) as T
}

function toRou3PrefixMatcher(path: `/${string}`): RegExp {
  const pattern = toRou3Pattern(path)
  return routeToRegExp(pattern === '/' ? '/**' : `${pattern}/**`)
}

function decodeParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, val]) => [key, safeDecodeURIComponent(val)]))
}
