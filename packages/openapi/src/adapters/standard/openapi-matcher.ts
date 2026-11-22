import { createPrefixMatcher, Router } from '@openapi-spec/router'
import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import {
  Procedure,
  resolveContractedProcedure,
  unlazy,
  walkProcedureContractsSync,
} from '@orpc/server'
import type { Value } from '@orpc/shared'
import { mergeHttpPath, pathToHttpPath, stripHttpPathPrefix, value } from '@orpc/shared'

import { DEFAULT_OPENAPI_METHOD } from '../../constants'
import { getOpenAPIMeta } from '../../meta'

export interface OpenAPIMatcherOptions {
  /**
   * Filter which procedures are exposed for matching. Return `false` to exclude.
   *
   * @default true
   */
  filter?:
    | Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]>
    | undefined
}

interface TreeEntry {
  path: string[]
  contract: AnyProcedureContract
  procedure?: AnyProcedure | undefined
}

interface PendingLazyRouter extends WalkProcedureContractsLazyResult {
  matcher?: ReturnType<typeof createPrefixMatcher> | undefined
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
    const lazyResults = walkProcedureContractsSync(
      router,
      (contract, path) => {
        if (!value(this.filter, contract, path)) {
          return
        }

        const meta = getOpenAPIMeta(contract)
        const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
        const postHttpPath = meta?.path ?? pathToHttpPath(path)
        const httpPath = meta?.prefix ? mergeHttpPath(meta.prefix, postHttpPath) : postHttpPath

        this.tree.add(method, httpPath, {
          path,
          contract,
          procedure: contract instanceof Procedure ? contract : undefined,
        })
      },
      path,
    )

    for (const result of lazyResults) {
      const prefix = getOpenAPIMeta(result.router)?.prefix

      this.pendingLazyRouters.add({
        ...result,
        matcher: prefix ? createPrefixMatcher(prefix) : undefined,
      })
    }
  }

  async match(
    method: string,
    pathname: `/${string}`,
    prefix: `/${string}` | undefined,
  ): Promise<
    | { path: string[]; procedure: AnyProcedure; params?: Record<string, string> | undefined }
    | undefined
  > {
    if (prefix) {
      const stripped = stripHttpPathPrefix(pathname, prefix)

      if (stripped === undefined) {
        return undefined
      }

      pathname = stripped
    }

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
      procedure: entry.procedure ?? (await this.resolveProcedure(entry)),
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
        await this.indexPendingLazyRouter(pending)
      }
    }
  }

  /**
   * Each match loads on its own instead of sharing an in-flight promise:
   * on Cloudflare Workers, a promise can never settle once the request that created it ends.
   */
  private async indexPendingLazyRouter(pending: PendingLazyRouter): Promise<void> {
    const { default: router } = await unlazy(pending.router)

    // a concurrent match may have indexed it already, and indexing twice would add its
    // routes twice and revive nested lazy routers that were already resolved
    if (!this.pendingLazyRouters.has(pending)) {
      return
    }

    this.index(router, pending.path)
    this.pendingLazyRouters.delete(pending)
  }

  private async resolveProcedure(entry: TreeEntry): Promise<AnyProcedure> {
    entry.procedure = await resolveContractedProcedure(this.rootRouter, entry.contract, entry.path)

    return entry.procedure
  }
}
