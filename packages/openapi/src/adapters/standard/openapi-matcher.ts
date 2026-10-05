import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import type { MatchedRoute } from 'rou3'
import { createContractProcedure, getRouter, Procedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, normalizeHttpPath, pathToHttpPath, safeDecodeURIComponent, setOwn, value } from '@orpc/shared'
import { addRoute, createRouter, findAllRoutes, findRoute, routeToRegExp } from 'rou3'
import { DEFAULT_OPENAPI_METHOD } from '../../constants'
import { getOpenAPIMeta } from '../../meta'
import { getDynamicPathParams } from '../../utils'

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
  params?: [rou3Key: string, name: string][] | undefined
  catchAllKey?: string | undefined
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
    const routes: { method: string, pattern: string, entry: TreeEntry }[] = []

    const lazyResults = walkProcedureContractsSync(router, (contract, path) => {
      if (!value(this.filter, contract, path)) {
        return
      }

      const meta = getOpenAPIMeta(contract)
      const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
      const postHttpPath = meta?.path ?? pathToHttpPath(path)
      const openapiPath = meta?.prefix ? mergeHttpPath(meta.prefix, postHttpPath) : postHttpPath
      const { pattern, ...route } = toRou3Route(openapiPath)

      routes.push({
        method,
        pattern,
        entry: {
          path,
          contract,
          procedure: contract instanceof Procedure ? contract : undefined,
          ...route,
        },
      })
    }, path)

    const pendingLazyRouters = lazyResults.map((result): PendingLazyRouter => {
      const prefix = getOpenAPIMeta(result.router)?.prefix

      return {
        ...result,
        matcher: prefix ? toRou3PrefixMatcher(prefix) : undefined,
      }
    })

    for (const { method, pattern, entry } of routes) {
      addRoute(this.tree, method, pattern, entry)
    }

    for (const pending of pendingLazyRouters) {
      this.pendingLazyRouters.add(pending)
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

    // most requests `await undefined` so conditionally await it to save a microtask turn
    const loading = this.resolvePendingLazyRouters(pathname)
    if (loading !== undefined) {
      await loading
    }

    let match = this.findMatch(method, pathname)

    if (match === undefined && pathname.includes('%')) {
      // Retry with a normalized path: users may percent-encode characters that
      // we store unencoded (e.g. "a%62c" vs "abc"), so normalization lets us
      // handle those requests without storing duplicate entries.
      // Raw characters we store encoded (e.g. "café") are not retried, to keep misses cheap.

      const normalizedPathname = normalizeHttpPath(pathname)

      // most requests `await undefined` so conditionally await it to save a microtask turn
      const normalizedLoading = this.resolvePendingLazyRouters(normalizedPathname)
      if (normalizedLoading !== undefined) {
        await normalizedLoading
      }

      match = this.findMatch(method, normalizedPathname)
    }

    if (match === undefined) {
      return undefined
    }

    const entry = match.data

    return {
      path: entry.path,
      procedure: entry.procedure ?? await this.resolveProcedure(entry),
      params: entry.params && decodeParams(entry.params, match.params!),
    }
  }

  private findMatch(method: string, pathname: `/${string}`): MatchedRoute<TreeEntry> | undefined {
    const match = findRoute(this.tree, method, pathname)

    if (match === undefined || !hasEmptyCatchAll(match)) {
      return match
    }

    return findAllRoutes(this.tree, method, pathname).reverse().find(match => !hasEmptyCatchAll(match))
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

function toRou3Route(path: `/${string}`): { pattern: `/${string}` } & Pick<TreeEntry, 'params' | 'catchAllKey'> {
  const dynamicParams = getDynamicPathParams(path)

  if (!dynamicParams) {
    return { pattern: escapeRou3Literal(path) as `/${string}` }
  }

  let pattern = ''
  let literalStart = 0
  let catchAllKey: string | undefined
  const params: [rou3Key: string, name: string][] = []

  for (const param of dynamicParams) {
    const key = `p${params.length}`
    params.push([key, param.parameterName])

    pattern += escapeRou3Literal(path.slice(literalStart, param.startIndex))
    literalStart = param.startIndex + param.segment.length

    if (param.allowsSlash) {
      if (catchAllKey !== undefined) {
        throw new TypeError(`OpenAPI path "${path}" has more than one catch-all param ({+name}), but only one is supported per path.`)
      }

      catchAllKey = key
      pattern += `:${key}(.*)`
    }
    else {
      pattern += `:${key}`
    }
  }

  pattern += escapeRou3Literal(path.slice(literalStart))

  return { pattern: pattern as `/${string}`, params, catchAllKey }
}

// rou3 syntax and the first dot of `.` / `..` segments; other dots stay unescaped, since escapes slow route registration
const ROU3_SYNTAX_REGEX = /[\\:*?+(){}]|(?<![^/])\.(?=\.?(?:\/|$))/g

function escapeRou3Literal(text: string): string {
  return text.replace(ROU3_SYNTAX_REGEX, '\\$&')
}

function toRou3PrefixMatcher(prefix: `/${string}`): RegExp {
  const catchAll = getDynamicPathParams(prefix)?.find(param => param.allowsSlash)
  const head = catchAll ? prefix.slice(0, catchAll.startIndex) as `/${string}` : prefix

  return routeToRegExp(mergeHttpPath(toRou3Route(head).pattern, '/**'))
}

function hasEmptyCatchAll(match: MatchedRoute<TreeEntry>): boolean {
  return match.data.catchAllKey !== undefined && !match.params?.[match.data.catchAllKey]
}

function decodeParams(params: [rou3Key: string, name: string][], values: Record<string, string>): Record<string, string> {
  const decoded: Record<string, string> = {}

  for (const [rou3Key, name] of params) {
    setOwn(decoded, name, safeDecodeURIComponent(values[rou3Key]!))
  }

  return decoded
}
