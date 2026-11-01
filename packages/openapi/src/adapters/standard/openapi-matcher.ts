import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, WalkProcedureContractsLazyResult } from '@orpc/server'
import type { Value } from '@orpc/shared'
import { createPrefixMatcher, Router } from '@openapi-spec/router'
import { Procedure, resolveContractProcedure, unlazy, walkProcedureContractsSync } from '@orpc/server'
import { mergeHttpPath, pathToHttpPath, value } from '@orpc/shared'
import { DEFAULT_OPENAPI_METHOD } from '../../constants'
import { getOpenAPIMeta } from '../../meta'

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
  matcher: ReturnType<typeof createPrefixMatcher>
  /**
   * in-flight load, shared so concurrent matches never load or re-index the same router twice.
   * Keeps its rejection when indexing fails, which would fail the same way on every attempt.
   */
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
    const lazyResults = walkProcedureContractsSync(router, (contract, path) => {
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
    }, path)

    for (const result of lazyResults) {
      this.pendingLazyRouters.add({
        ...result,
        // a prefix of "/" matches every pathname
        matcher: createPrefixMatcher(getOpenAPIMeta(result.router)?.prefix ?? '/'),
      })
    }
  }

  async match(
    method: string,
    pathname: `/${string}`,
    prefix: `/${string}` | undefined,
  ): Promise<{ path: string[], procedure: AnyProcedure, params?: Record<string, string> | undefined } | undefined> {
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
      if (pending.matcher(pathname)) {
        return this.loadPendingLazyRouters(pathname)
      }
    }
  }

  private async loadPendingLazyRouters(pathname: `/${string}`): Promise<void> {
    for (const pending of this.pendingLazyRouters) {
      if (pending.matcher(pathname)) {
        await this.loadPendingLazyRouter(pending)
      }
    }
  }

  private loadPendingLazyRouter(pending: PendingLazyRouter): Promise<void> {
    // a loader that throws synchronously leaves `loading` unset, so the next match retries it
    pending.loading ??= unlazy(pending.router).then(
      ({ default: router }) => {
        // a throw here stays in `loading`, so later matches rethrow it instead of
        // adding the routes indexed before the failure again
        this.index(router, pending.path)

        // removed only once indexed, so a concurrent match never observes this router as
        // neither pending nor indexed
        this.pendingLazyRouters.delete(pending)
      },
      (error) => {
        // a failed load may succeed later, so the next match retries it
        pending.loading = undefined
        throw error
      },
    )

    return pending.loading
  }

  private async resolveProcedure(entry: TreeEntry): Promise<AnyProcedure> {
    entry.procedure = await resolveContractProcedure(this.rootRouter, entry.contract, entry.path)

    return entry.procedure
  }
}
