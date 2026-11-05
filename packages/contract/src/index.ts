export * from './builder.ts'
export * from './builder-variants.ts'
export * from './client-factory.ts'
export * from './error.ts'
export * from './error-factory.ts'
export * from './error-utils.ts'
export * from './meta.ts'
export * from './meta-built-in.ts'
export * from './meta-utils.ts'
export * from './procedure.ts'
export type {
  /**
   * @deprecated Use `AnyProcedureContract` instead.
   */
  AnyProcedureContract as AnyContractProcedure,
} from './procedure.ts'
export * from './procedure-client.ts'
export * from './router.ts'
export type {
  /**
   * @deprecated Use `RouterContract` instead.
   */
  RouterContract as AnyContractRouter,
  /**
   * @deprecated Use `InferRouterContractErrorMap` instead.
   */
  InferRouterContractErrorMap as InferContractRouterErrorMap,
  /**
   * @deprecated Use `InferRouterContractInputs` instead.
   */
  InferRouterContractInputs as InferContractRouterInputs,
  /**
   * @deprecated Use `InferRouterContractOutputs` instead.
   */
  InferRouterContractOutputs as InferContractRouterOutputs,
} from './router.ts'
export * from './router-client.ts'
export type {
  /**
   * @deprecated Use `RouterContractClient` instead.
   */
  RouterContractClient as ContractRouterClient,
} from './router-client.ts'
export {
  getProcedureContractOrThrow,
  getRouterContract,
  minifyRouterContract,
} from './router-utils.ts'
export type {
  AugmentContractRouterOptions,
  AugmentedContractRouter,
} from './router-utils.ts'
export {
  /**
   * @deprecated Use `getRouterContract` instead.
   */
  getRouterContract as getContractRouter,
  /**
   * @deprecated Use `minifyRouterContract` instead.
   */
  minifyRouterContract as minifyContractRouter,
} from './router-utils.ts'
export * from './schema.ts'
export {
  asyncIteratorObject,
  getAsyncIteratorObjectSchemasDetails,
} from './schema-built-in.ts'
export type { AsyncIteratorObjectSchemasDetails } from './schema-built-in.ts'
export {
  /**
   * @deprecated Use `asyncIteratorObject` instead.
   */
  asyncIteratorObject as eventIterator,
} from './schema-built-in.ts'
export * from './schema-utils.ts'

export type {
  Client,
  ClientContext,
  ClientOptions,
  ClientRest,
  FriendlyClientOptions,
} from '@orpc/client'

export type {
  AsyncIteratorClass,
  PromiseWithError,
  Registry,
  ThrowableError,
} from '@orpc/shared'
