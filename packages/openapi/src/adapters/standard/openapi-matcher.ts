import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import { createContractProcedure, getRouter, Procedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, pathToHttpPath, safeDecodeURIComponent, safeEncodeURIComponent, value } from '@orpc/shared'
import { addRoute, createRouter, findRoute, routeToRegExp } from 'rou3'
import { DEFAULT_OPENAPI_METHOD } from '../../constants'
import { getOpenAPIMeta } from '../../meta'
import { getDynamicPathParams } from '../../utils'

/**
 * Matches any character that {@link toCanonicalHttpPath} may rewrite.
 * `%` is included because an escape may decode to a character that is stored unencoded.
 */
const NON_CANONICAL_HTTP_PATH_REGEX = /[^\w\-.!~'/]/

/**
 * Characters `encodeURIComponent` leaves unencoded that rou3 parses as route syntax.
 */
const ROU3_SYNTAX_CHAR_REGEX = /[*()]/g
const ROU3_SYNTAX_CHAR_ESCAPES: Record<string, string> = { '*': '%2A', '(': '%28', ')': '%29' }

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
      const rou3Path = toRou3Pattern(openapiPath)

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

    // Routes are indexed in canonical form, so equivalent spellings of a path (e.g. "a%62c" vs "abc",
    // "files:get" vs "files%3Aget") match the same route without storing duplicate entries.
    // Canonicalizing before the lookup, rather than retrying after a miss, also keeps a static
    // route ahead of a param route that the raw spelling would have matched instead.
    if (NON_CANONICAL_HTTP_PATH_REGEX.test(pathname)) {
      pathname = toCanonicalHttpPath(pathname)
    }

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
 * The form routes are indexed in and request paths are matched in: every segment is decoded and
 * re-encoded, like `normalizeHttpPath`, so static text never reaches rou3 unencoded
 * (e.g. `:` would start a param, `{` a group). The `*`, `(` and `)` that survive
 * `encodeURIComponent` are percent-encoded as well, because rou3 0.9 cannot backslash-escape
 * `*` inside a segment and `routeToRegExp` produces an invalid RegExp for `\:`.
 */
function toCanonicalHttpPath<T extends string>(path: T): T {
  return path.split('/').map(toCanonicalHttpPathSegment).join('/') as T
}

function toCanonicalHttpPathSegment(segment: string): string {
  if (!NON_CANONICAL_HTTP_PATH_REGEX.test(segment)) {
    return segment
  }

  return safeEncodeURIComponent(safeDecodeURIComponent(segment))
    .replace(ROU3_SYNTAX_CHAR_REGEX, char => ROU3_SYNTAX_CHAR_ESCAPES[char]!)
}

function toRou3Pattern(path: `/${string}`): `/${string}` {
  const params = getDynamicPathParams(path)

  if (!params?.length) {
    return toCanonicalHttpPath(path)
  }

  let pattern = ''
  let staticStart = 0

  for (const param of params) {
    pattern += toCanonicalHttpPath(path.slice(staticStart, param.startIndex))
    pattern += param.allowsSlash ? `**:${param.parameterName}` : `:${param.parameterName}`
    staticStart = param.startIndex + param.segment.length
  }

  return `${pattern}${toCanonicalHttpPath(path.slice(staticStart))}` as `/${string}`
}

function toRou3PrefixMatcher(path: `/${string}`): RegExp {
  const pattern = toRou3Pattern(path)
  return routeToRegExp(pattern === '/' ? '/**' : `${pattern}/**`)
}

function decodeParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, val]) => [key, safeDecodeURIComponent(val)]))
}
