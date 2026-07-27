import type { HTTPPath } from '@orpc/client'
import type { AnyContractProcedure } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, LazyTraverseContractProceduresOptions, TraverseContractProcedureCallbackOptions } from '@orpc/server'
import type { StandardMatcher, StandardMatchResult } from '@orpc/server/standard'
import type { Value } from '@orpc/shared'
import { toHttpPath } from '@orpc/client/standard'
import { fallbackContractConfig } from '@orpc/contract'
import { createContractedProcedure, getLazyMeta, getRouter, isProcedure, traverseContractProcedures, unlazy } from '@orpc/server'
import { value } from '@orpc/shared'
import { addRoute, createRouter, findRoute } from 'rou3'
import { decodeParams, toRou3Pattern } from './utils'

export interface StandardOpenAPIMatcherOptions {
  /**
   * Filter procedures. Return `false` to exclude a procedure from matching.
   *
   * @default true
   */
  filter?: Value<boolean, [options: TraverseContractProcedureCallbackOptions]>
}

export class StandardOpenAPIMatcher implements StandardMatcher {
  private readonly filter: Exclude<StandardOpenAPIMatcherOptions['filter'], undefined>

  private readonly tree = createRouter<{
    path: readonly string[]
    contract: AnyContractProcedure
    procedure: AnyProcedure | undefined
    router: AnyRouter
  }>()

  private readonly pendingRouters: (LazyTraverseContractProceduresOptions & {
    httpPathPrefix: HTTPPath
    laziedPrefix: string | undefined
    initPromise?: Promise<void>
  }) [] = []

  constructor(options: StandardOpenAPIMatcherOptions = {}) {
    this.filter = options.filter ?? true
  }

  init(router: AnyRouter, path: readonly string[] = []): void {
    const laziedOptions = traverseContractProcedures({ router, path }, (traverseOptions) => {
      if (!value(this.filter, traverseOptions)) {
        return
      }

      const { path, contract } = traverseOptions

      const method = fallbackContractConfig('defaultMethod', contract['~orpc'].route.method)
      const httpPath = toRou3Pattern(contract['~orpc'].route.path ?? toHttpPath(path))

      if (isProcedure(contract)) {
        addRoute(this.tree, method, httpPath, {
          path,
          contract,
          procedure: contract, // this mean dev not used contract-first so we can used contract as procedure directly
          router,
        })
      }
      else {
        addRoute(this.tree, method, httpPath, {
          path,
          contract,
          procedure: undefined,
          router,
        })
      }
    })

    this.pendingRouters.push(...laziedOptions.map(option => ({
      ...option,
      httpPathPrefix: toHttpPath(option.path),
      laziedPrefix: getLazyMeta(option.router).prefix,
    })))
  }

  async match(method: string, pathname: HTTPPath): Promise<StandardMatchResult> {
    /**
     * Resolve pending routers one at a time and re-scan after each, so lazy routers
     * nested inside a just-initialized lazy router are also picked up.
     */
    while (true) {
      const pendingRouter = this.pendingRouters.find(
        pendingRouter => !pendingRouter.laziedPrefix
          || pathname.startsWith(pendingRouter.laziedPrefix)
          || pathname.startsWith(pendingRouter.httpPathPrefix),
      )

      if (!pendingRouter) {
        break
      }

      /**
       * Memoize the init work and only remove the pending router after it finishes,
       * so concurrent requests share a single init instead of re-initializing
       * the same router or dropping pending routers pushed by each other.
       */
      pendingRouter.initPromise ??= unlazy(pendingRouter.router).then(({ default: router }) => {
        this.init(router, pendingRouter.path)
        this.pendingRouters.splice(this.pendingRouters.indexOf(pendingRouter), 1)
      }).catch((error) => {
        pendingRouter.initPromise = undefined // allow retrying on failure
        throw error
      })

      await pendingRouter.initPromise
    }

    const match = findRoute(this.tree, method, pathname)

    if (!match) {
      return undefined
    }

    if (!match.data.procedure) {
      const { default: maybeProcedure } = await unlazy(getRouter(match.data.router, match.data.path))

      if (!isProcedure(maybeProcedure)) {
        throw new Error(`
          [Contract-First] Missing or invalid implementation for procedure at path: ${toHttpPath(match.data.path)}.
          Ensure that the procedure is correctly defined and matches the expected contract.
        `)
      }

      match.data.procedure = createContractedProcedure(maybeProcedure, match.data.contract)
    }

    return {
      path: match.data.path,
      procedure: match.data.procedure,
      params: match.params ? decodeParams(match.params) : undefined,
    }
  }
}
