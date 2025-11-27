import type { AnyContractRouter } from '@orpc/contract'
import type { BuilderConfig, Context, Implementer } from '@orpc/server'
import type { ORPCGlobalContext } from './module'
import { implement as baseImplement } from '@orpc/server'

export * from './implement'
export { Implement as Impl } from './implement'
export * from './module'
export * from './utils'

export { onError, onFinish, onStart, onSuccess, ORPCError } from '@orpc/server'
export type {
  ImplementedProcedure,
  Implementer,
  ImplementerInternal,
  ImplementerInternalWithMiddlewares,
  ProcedureImplementer,
  RouterImplementer,
  RouterImplementerWithMiddlewares,
} from '@orpc/server'

/**
 * Alias for `implement` from `@orpc/server` with default context set to `ORPCGlobalContext`
 */
export function implement<T extends AnyContractRouter, TContext extends Context = ORPCGlobalContext>(
  contract: T,
  config: BuilderConfig = {},
): Implementer<T, TContext, TContext> {
  return baseImplement(contract, config)
}
