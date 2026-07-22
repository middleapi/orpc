export * from './builder'
export * from './builder-variants'
export * from './client-factory'
export * from './error'
export * from './error-utils'
export * from './meta'
export * from './meta-built-in'
export * from './meta-utils'
export * from './procedure'
export * from './procedure-client'
export * from './router'
export * from './router-client'
export * from './router-utils'
export * from './schema'
export * from './schema-built-in'
export {
  /**
   * @deprecated Use `asyncIteratorObject` instead.
   */
  asyncIteratorObject as eventIterator,
} from './schema-built-in'
export * from './schema-utils'

export type {
  Client,
  ClientContext,
  ClientOptions,
  ClientRest,
  FriendlyClientOptions,
} from '@orpc/client'

export type {
  PromiseWithError,
  Registry,
  ThrowableError,
} from '@orpc/shared'
