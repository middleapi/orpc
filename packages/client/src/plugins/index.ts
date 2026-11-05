export * from './batch.ts'
export * from './cookie-jar.ts'
export * from './dedupe.ts'
export {
  /**
   * @deprecated Use `DedupeLinkPlugin` instead.
   */
  DedupeLinkPlugin as DedupeRequestsPlugin,
} from './dedupe.ts'
export * from './request-compression.ts'
export * from './response-compression.ts'
export * from './retry.ts'
export {
  /**
   * @deprecated Use `RetryLinkPlugin` instead.
   */
  RetryLinkPlugin as ClientRetryPlugin,
} from './retry.ts'
export type {
  /**
   * @deprecated Use `RetryLinkPluginContext` instead.
   */
  RetryLinkPluginContext as ClientRetryPluginContext,
} from './retry.ts'
export * from './retry-after.ts'
export {
  /**
   * @deprecated Use `RetryAfterLinkPlugin` instead.
   */
  RetryAfterLinkPlugin as RetryAfterPlugin,
} from './retry-after.ts'
export * from './timeout.ts'
