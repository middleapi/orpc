import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import { createContractProcedure, getRouter, Procedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, normalizeHttpPath, pathToHttpPath, tryDecodeURIComponent, value } from '@orpc/shared'
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
}

export class OpenAPIMatcher {
  private readonly filter: Exclude<OpenAPIMatcherOptions['filter'], undefined>
  private readonly rootRouter: AnyRouter

  private readonly tree = createRouter<TreeEntry>()

  private pendingLazyRouters: PendingLazyRouter[] = []

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

    this.pendingLazyRouters.push(...lazyResults.map((result) => {
      const prefix = getOpenAPIMeta(result.router)?.prefix

      return {
        ...result,
        matcher: prefix ? toRou3PrefixMatcher(prefix) : undefined,
      }
    }))
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

    const result = await this.matchPathname(method, pathname)

    if (!result && pathname.includes('%')) {
      // Retry with a normalized path: users may percent-encode characters that
      // we store unencoded (e.g. "a%62c" vs "abc"), so normalization lets us
      // handle those requests without storing duplicate entries.

      return this.matchPathname(method, normalizeHttpPath(pathname))
    }

    return result
  }

  private async matchPathname(
    method: string,
    pathname: `/${string}`,
  ): Promise<{ path: string[], procedure: AnyProcedure, params?: Record<string, string> | undefined } | undefined> {
    await this.resolvePendingLazyRouters(pathname)

    const match = findRoute(this.tree, method, pathname)

    if (!match) {
      return undefined
    }

    const procedure = await this.resolveProcedure(match.data)

    return {
      path: match.data.path,
      procedure,
      params: match.params ? decodeParams(match.params) : undefined,
    }
  }

  private async resolvePendingLazyRouters(pathname: `/${string}`): Promise<void> {
    if (!this.pendingLazyRouters.length) {
      return
    }

    const stillPending: typeof this.pendingLazyRouters = []

    // We need to loop over this.pendingLazyRouters because this.index can still append new lazy routers
    // that might need to be resolved
    for (const pending of this.pendingLazyRouters) {
      if (!pending.matcher || pending.matcher.test(pathname)) {
        const { default: router } = await unlazy(pending.router)
        this.index(router, pending.path)
      }
      else {
        stillPending.push(pending)
      }
    }

    this.pendingLazyRouters = stillPending
  }

  private async resolveProcedure(entry: TreeEntry): Promise<AnyProcedure> {
    if (entry.procedure) {
      return entry.procedure
    }

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
  return Object.fromEntries(Object.entries(params).map(([key, val]) => [key, tryDecodeURIComponent(val)]))
}
