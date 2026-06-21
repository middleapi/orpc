import type { AnyProcedureContract } from '@orpc/contract'
import type { Value } from '@orpc/shared'
import type { StandardMethod } from '@standardserver/core'
import type { AnyProcedure } from '../../procedure'
import type { AnyRouter } from '../../router'
import type { WalkProcedureContractsLazyResult } from '../../router-utils'
import { normalizeHttpPath, pathToHttpPath, value } from '@orpc/shared'
import { unlazy } from '../../lazy'
import { Procedure } from '../../procedure'
import { createContractProcedure } from '../../procedure-utils'
import { getRouter, walkProcedureContractsSync } from '../../router-utils'

export interface RPCMatcherOptions {
  /**
   * Filter which procedures are exposed for matching. Return `false` to exclude.
   *
   * @default true
   */
  filter?: Value<boolean, [procedure: AnyProcedureContract | AnyProcedure, path: string[]]>
}

interface TreeEntry {
  path: string[]
  contract: AnyProcedureContract
  procedure?: AnyProcedure | undefined
}

export class RPCMatcher {
  private readonly filter: Exclude<RPCMatcherOptions['filter'], undefined>
  private readonly rootRouter: AnyRouter

  private readonly tree: Map<`/${string}`, TreeEntry> = new Map()

  private pendingLazyRouters: (WalkProcedureContractsLazyResult & { httpPathPrefix: string })[] = []

  constructor(router: AnyRouter, options: RPCMatcherOptions = {}) {
    this.filter = options.filter ?? true
    this.rootRouter = router
    this.index(router)
  }

  private index(router: AnyRouter, path: string[] = []): void {
    const lazyResults = walkProcedureContractsSync(router, (procedure, procedurePath) => {
      if (!value(this.filter, procedure, procedurePath)) {
        return
      }

      const httpPath = pathToHttpPath(procedurePath)

      if (procedure instanceof Procedure) {
        this.tree.set(httpPath, {
          path: procedurePath,
          contract: procedure,
          procedure,
        })
      }
      else {
        // contract-first approach
        this.tree.set(httpPath, {
          path: procedurePath,
          contract: procedure,
        })
      }
    }, path)

    this.pendingLazyRouters.push(
      ...lazyResults.map(result => ({
        ...result,
        httpPathPrefix: pathToHttpPath(result.path),
      })),
    )
  }

  async match(_method: StandardMethod, pathname: `/${string}`, prefix: `/${string}` | undefined): Promise<{ path: string[], procedure: AnyProcedure } | undefined> {
    if (pathname.length > 1 && pathname.endsWith('/')) {
      // Remove trailing slash for matching
      pathname = pathname.slice(0, -1) as `/${string}`
    }

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

    const result = await this.matchPathname(pathname)

    if (!result && pathname.includes('%')) {
      // Retry with a normalized path: users may percent-encode characters that
      // we store unencoded (e.g. "a%62c" vs "abc"), so normalization lets us
      // handle those requests without storing duplicate entries.

      return this.matchPathname(normalizeHttpPath(pathname))
    }

    return result
  }

  private async matchPathname(pathname: `/${string}`): Promise<{ path: string[], procedure: AnyProcedure } | undefined> {
    await this.resolvePendingLazyRouters(pathname)

    const entry = this.tree.get(pathname)

    if (!entry) {
      return undefined
    }

    const procedure = await this.resolveProcedure(entry)

    return { path: entry.path, procedure }
  }

  private async resolvePendingLazyRouters(pathname: `/${string}`): Promise<void> {
    if (!this.pendingLazyRouters.length) {
      return
    }

    const stillPending: typeof this.pendingLazyRouters = []

    // We need to loop over this.pendingLazyRouters because this.index can still append new lazy routers
    // that might need to be resolved
    for (const pending of this.pendingLazyRouters) {
      if (pathname.startsWith(pending.httpPathPrefix)) {
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
