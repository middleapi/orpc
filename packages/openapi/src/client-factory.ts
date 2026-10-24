import type { ClientContext, ClientLink, ORPCClientOptions } from '@orpc/client'
import type { RouterContract, RouterContractClient } from '@orpc/contract'
import type { JsonifiedClient } from './types'
import { createContractClientFactory } from '@orpc/contract'

export interface ContractJsonifiedClientFactory<
  TClientContext extends ClientContext,
> {
  <T extends RouterContract>(contract: T): JsonifiedClient<RouterContractClient<T, TClientContext>>
}

export interface ContractJsonifiedClientFactoryOptions<
  TClientContext extends ClientContext,
> extends Pick<ORPCClientOptions<JsonifiedClient<RouterContractClient<RouterContract, TClientContext>>>, 'interceptors' | 'scoped'> {
  /**
   * An optional reference to the root router-contract.
   * When provided, the client factory will automatically register the passed contract
   * into the router at the path defined by `meta.path`.
   */
  contractRef?: RouterContract | undefined
}

/**
 * Like `createContractClientFactory`, but the clients it builds are typed as `JsonifiedClient`,
 * for links that require it, such as OpenAPI Link.
 *
 * @remarks
 * **Warning**: Every procedure contract passed to the factory must define `meta.path` matching its location in the root contract.
 *
 * @see {@link https://orpc.dev/docs/contract/client-factory | Contract Client Factory}
 */
export function createContractJsonifiedClientFactory<
  TClientContext extends ClientContext,
>(
  link: ClientLink<TClientContext>,
  options: ContractJsonifiedClientFactoryOptions<TClientContext> = {},
): ContractJsonifiedClientFactory<TClientContext> {
  return createContractClientFactory(link, options) as ContractJsonifiedClientFactory<TClientContext>
}
