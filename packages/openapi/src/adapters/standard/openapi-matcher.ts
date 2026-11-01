import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import { createPrefixMatcher, Router } from '@openapi-spec/router'
import { Procedure, resolveContractProcedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, pathToHttpPath, value } from '@orpc/shared'
import { DEFAULT_OPENAPI_METHOD } from '../../constants'
import { getOpenAPIMeta } from '../../meta'
import { getDynamicPathParams } from '../../utils'

export interface OpenAPIMatcherOptions {
  /**
   * Filter which procedures are exposed for matching. Return `false` to exclude.
   *
   * @default true
   */
  filter?: Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]> | undefined
}

interface TreeEntry {
  path: string[]
  contract: AnyProcedureContract
  procedure?: AnyProcedure | undefined
}

interface PendingLazyRouter extends WalkProcedureContractsLazyResult {
  matcher?: ReturnType<typeof createPrefixMatcher> | undefined
  /** in-flight load, shared so concurrent matches never load or re-index the same router twice */
  loading?: Promise<void> | undefined
}

export class OpenAPIMatcher {
  private readonly filter: Exclude<OpenAPIMatcherOptions['filter'], undefined>
  private readonly rootRouter: AnyRouter

  private readonly tree = new Router<TreeEntry>()
  private readonly pendingLazyRouters: Set<PendingLazyRouter> = new Set()

  constructor(router: AnyRouter, options: OpenAPIMatcherOptions = {}) {
    this.filter = options.filter ?? true
    this.rootRouter = router
    this.index(router)
  }

  private index(router: AnyRouter, path: string[] = []): void {
    const routes: { method: string, httpPath: `/${string}`, entry: TreeEntry }[] = []

    const lazyResults = walkProcedureContractsSync(router, (contract, path) => {
      if (!value(this.filter, contract, path)) {
        return
      }

      const meta = getOpenAPIMeta(contract)
      const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
      const postHttpPath = meta?.path ?? pathToHttpPath(path)
      const httpPath = meta?.prefix ? mergeHttpPath(meta.prefix, postHttpPath) : postHttpPath

      assertSingleCatchAll(httpPath)

      routes.push({
        method,
        httpPath,
        entry: {
          path,
          contract,
          procedure: contract instanceof Procedure ? contract : undefined,
        },
      })
    }, path)

    const pendingLazyRouters = lazyResults.map((result): PendingLazyRouter => {
      const prefix = getOpenAPIMeta(result.router)?.prefix

      return {
        ...result,
        matcher: prefix ? createPrefixMatcher(prefix) : undefined,
      }
    })

    // added only once every path is known to be valid, so an invalid one indexes none of the router's routes
    for (const { method, httpPath, entry } of routes) {
      this.tree.add(method, httpPath, entry)
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
    // the router ignores one trailing slash, in routes and requests
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

    // The router and prefix matchers compare path text however the route or the request
    // percent-encodes it ("a%62c" vs "abc", "a^b" vs "a%5Eb"), so the pathname is passed as is.

    // most requests `await undefined` so conditionally await it to save a microtask turn
    const loading = this.resolvePendingLazyRouters(pathname)
    if (loading !== undefined) {
      await loading
    }

    const match = this.tree.match(method, pathname)

    if (match === undefined) {
      return undefined
    }

    const entry = match.data

    return {
      path: entry.path,
      procedure: entry.procedure ?? await this.resolveProcedure(entry),
      params: match.params,
    }
  }

  private resolvePendingLazyRouters(pathname: `/${string}`): Promise<void> | void {
    for (const pending of this.pendingLazyRouters) {
      if (pending.matcher === undefined || pending.matcher(pathname)) {
        return this.loadPendingLazyRouters(pathname)
      }
    }
  }

  private async loadPendingLazyRouters(pathname: `/${string}`): Promise<void> {
    for (const pending of this.pendingLazyRouters) {
      if (pending.matcher === undefined || pending.matcher(pathname)) {
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
    entry.procedure = await resolveContractProcedure(this.rootRouter, entry.contract, entry.path)

    return entry.procedure
  }
}

/**
 * Throws the router's own error for a path with more than one catch-all param, before any
 * route is added, which the router alone can only do for one path at a time.
 */
function assertSingleCatchAll(path: `/${string}`): void {
  const first = path.indexOf('{+')

  if (
    first !== -1
    && path.includes('{+', first + 2)
    && (getDynamicPathParams(path)?.filter(param => param.allowsSlash).length ?? 0) > 1
  ) {
    throw new TypeError(`OpenAPI path "${path}" has more than one catch-all param ({+name}), but only one is supported per path.`)
  }
}
