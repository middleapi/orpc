import type { HTTPPath } from '@orpc/client'
import type { AnyContractProcedure } from '@orpc/contract'
import type { Value } from '@orpc/shared'
import type { AnyProcedure } from '../../procedure'
import type { AnyRouter } from '../../router'
import type { LazyTraverseContractProceduresOptions, TraverseContractProcedureCallbackOptions } from '../../router-utils'
import type { StandardMatcher, StandardMatchResult } from './types'
import { toHttpPath } from '@orpc/client/standard'
import { NullProtoObj, value } from '@orpc/shared'
import { unlazy } from '../../lazy'
import { isProcedure } from '../../procedure'
import { createContractedProcedure } from '../../procedure-utils'
import { getRouter, traverseContractProcedures } from '../../router-utils'

export interface StandardRPCMatcherOptions {
  /**
   * Filter procedures. Return `false` to exclude a procedure from matching.
   *
   * @default true
   */
  filter?: Value<boolean, [options: TraverseContractProcedureCallbackOptions]>
}

export class StandardRPCMatcher implements StandardMatcher {
  private readonly filter: Exclude<StandardRPCMatcherOptions['filter'], undefined>

  private readonly tree: Record<
    HTTPPath,
    {
      path: readonly string[]
      contract: AnyContractProcedure
      procedure: AnyProcedure | undefined
      router: AnyRouter
    }
  > = new NullProtoObj()

  private readonly pendingRouters: (LazyTraverseContractProceduresOptions & {
    httpPathPrefix: HTTPPath
    initPromise?: Promise<void>
  }) [] = []

  constructor(options: StandardRPCMatcherOptions = {}) {
    this.filter = options.filter ?? true
  }

  init(router: AnyRouter, path: readonly string[] = []): void {
    const laziedOptions = traverseContractProcedures({ router, path }, (traverseOptions) => {
      if (!value(this.filter, traverseOptions)) {
        return
      }

      const { path, contract } = traverseOptions

      const httpPath = toHttpPath(path)

      if (isProcedure(contract)) {
        this.tree[httpPath] = {
          path,
          contract,
          procedure: contract, // this mean dev not used contract-first so we can used contract as procedure directly
          router,
        }
      }
      else {
        this.tree[httpPath] = {
          path,
          contract,
          procedure: undefined,
          router,
        }
      }
    })

    this.pendingRouters.push(...laziedOptions.map(option => ({
      ...option,
      httpPathPrefix: toHttpPath(option.path),
    })))
  }

  async match(_method: string, pathname: HTTPPath): Promise<StandardMatchResult> {
    /**
     * Resolve pending routers one at a time and re-scan after each, so lazy routers
     * nested inside a just-initialized lazy router are also picked up.
     */
    while (true) {
      const pendingRouter = this.pendingRouters.find(
        pendingRouter => pathname.startsWith(pendingRouter.httpPathPrefix),
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

    const match = this.tree[pathname]

    if (!match) {
      return undefined
    }

    if (!match.procedure) {
      const { default: maybeProcedure } = await unlazy(getRouter(match.router, match.path))

      if (!isProcedure(maybeProcedure)) {
        throw new Error(`
          [Contract-First] Missing or invalid implementation for procedure at path: ${toHttpPath(match.path)}.
          Ensure that the procedure is correctly defined and matches the expected contract.
        `)
      }

      match.procedure = createContractedProcedure(maybeProcedure, match.contract)
    }

    return {
      path: match.path,
      procedure: match.procedure,
    }
  }
}
