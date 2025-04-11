import type { HTTPPath } from '@orpc/client'
import type { AnyContractProcedure } from '@orpc/contract'
import type { AnyProcedure, AnyRouter, LazyTraverseContractProceduresOptions } from '@orpc/server'
import type { StandardMatcher, StandardMatchResult } from '@orpc/server/standard'
import { toHttpPath } from '@orpc/client/standard'
import { fallbackContractConfig } from '@orpc/contract'
import { createContractedProcedure, getLazyMeta, getRouter, isProcedure, traverseContractProcedures, unlazy } from '@orpc/server'
import { addRoute, createRouter, findRoute } from 'rou3'
import { decodeParams, toRou3Pattern } from './utils'

export class StandardOpenAPIMatcher implements StandardMatcher {
  private readonly tree = createRouter<{
    path: readonly string[]
    contract: AnyContractProcedure
    procedure: AnyProcedure | undefined
    router: AnyRouter
  }>()

  private pendingRouters: (LazyTraverseContractProceduresOptions & { httpPathPrefix: HTTPPath, laziedPrefix: string | undefined }) [] = []

  init(router: AnyRouter, path: readonly string[] = []): void {
    const laziedOptions = traverseContractProcedures({ router, path }, ({ path, contract }) => {
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
    if (this.pendingRouters.length) {
      const newPendingRouters: typeof this.pendingRouters = []

      for (const pendingRouter of this.pendingRouters) {
        if (
          !pendingRouter.laziedPrefix
          || pathname.startsWith(pendingRouter.laziedPrefix)
          || pathname.startsWith(pendingRouter.httpPathPrefix)
        ) {
          const { default: router } = await unlazy(pendingRouter.router)
          this.init(router, pendingRouter.path)
        }
        else {
          newPendingRouters.push(pendingRouter)
        }
      }

      this.pendingRouters = newPendingRouters
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
