import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import { createContractProcedure, getRouter, Procedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, normalizeHttpPath, pathToHttpPath, safeDecodeURIComponent, value } from '@orpc/shared'
import { addRoute, createRouter, findRoute, routeToRegExp } from 'rou3'
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

    // most requests `await undefined` so conditionally await it to save a microtask turn
    const loading = this.resolvePendingLazyRouters(pathname)
    if (loading !== undefined) {
      await loading
    }

    let match = findRoute(this.tree, method, pathname)

    if (match === undefined && pathname.includes('%')) {
      // Retry with a normalized path: users may percent-encode characters that
      // we store unencoded (e.g. "a%62c" vs "abc"), so normalization lets us
      // handle those requests without storing duplicate entries.

      const normalizedPathname = normalizeHttpPath(pathname)

      // most requests `await undefined` so conditionally await it to save a microtask turn
      const normalizedLoading = this.resolvePendingLazyRouters(normalizedPathname)
      if (normalizedLoading !== undefined) {
        await normalizedLoading
      }

      match = findRoute(this.tree, method, normalizedPathname)
    }

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

function toRou3Pattern(path: `/${string}`): `/${string}` {
  const params = getDynamicPathParams(path)

  if (!params?.length) {
    return path
  }

  for (let i = params.length - 1; i >= 0; i--) {
    const param = params[i]!
    const pattern = param.allowsSlash ? `**:${param.parameterName}` : `:${param.parameterName}`
    path = path.slice(0, param.startIndex) + pattern + path.slice(param.startIndex + param.segment.length)
  }

  return path
}

function toRou3PrefixMatcher(path: `/${string}`): RegExp {
  const pattern = toRou3Pattern(path)
  return routeToRegExp(pattern === '/' ? '/**' : `${pattern}/**`)
}

function decodeParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, val]) => [key, safeDecodeURIComponent(val)]))
}
