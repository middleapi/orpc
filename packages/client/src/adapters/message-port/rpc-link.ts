import type { ClientContext } from '../../types'
import type { StandardRPCLinkOptions } from '../standard'
import type { LinkMessagePortClientOptions } from './link-client'
import { StandardRPCLink } from '../standard'
import { LinkMessagePortClient } from './link-client'

export interface RPCLinkOptions<T extends ClientContext>
  extends Omit<StandardRPCLinkOptions<T>, 'url' | 'method' | 'fallbackMethod' | 'maxUrlLength'>, LinkMessagePortClientOptions {}

/**
 * The RPC Link for common message port implementations.
 *
 * @see {@link https://orpc.dev/docs/client/rpc-link RPC Link Docs}
 * @see {@link https://orpc.dev/docs/adapters/message-port Message Port Adapter Docs}
 */
export class RPCLink<T extends ClientContext> extends StandardRPCLink<T> {
  constructor(options: RPCLinkOptions<T>) {
    const linkClient = new LinkMessagePortClient(options)
    super(linkClient, { ...options, url: 'http://orpc' })
  }
}
