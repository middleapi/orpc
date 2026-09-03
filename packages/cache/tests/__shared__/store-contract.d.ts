import type { CacheStore } from '../../src'

export interface CacheStoreContractOptions {
  /**
   * Whether the store serializes outputs, and so drops values it cannot
   * encode instead of storing them.
   *
   * @default false
   */
  serializes?: boolean
}
/**
 * The behavior every {@link CacheStore} must share, run against one adapter.
 * Adapter suites keep only what is specific to their backend.
 */
export declare function describeCacheStoreContract(createStore: () => CacheStore, options?: CacheStoreContractOptions): void
// # sourceMappingURL=store-contract.d.ts.map
