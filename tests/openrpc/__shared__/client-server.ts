import type { ClientContext } from '@orpc/client'
import type { OpenRPCClient } from '@orpc/openrpc'
import type { OpenRPCLink, OpenRPCLinkOptions } from '@orpc/openrpc/fetch'
import type { OpenRPCEnvelopeHandlerPluginOptions, OpenRPCHandlerCodecOptions } from '@orpc/openrpc/standard'
import type { AnyRouter, Context, RouterClient } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'

/**
 * The prefix the JSON-RPC endpoint is mounted at, so `${origin}/rpc` is the endpoint URL.
 */
export const OPENRPC_PREFIX = '/rpc'

export interface OpenRPCClientServerTestOptions<TClientContext extends ClientContext> {
  context?: Context
  /**
   * Options shared by every `OpenRPCHandler` adapter.
   */
  handler?: StandardHandlerOptions<any> & OpenRPCHandlerCodecOptions<any> & OpenRPCEnvelopeHandlerPluginOptions<any>
  link?: Omit<OpenRPCLinkOptions<TClientContext>, 'url' | 'origin' | 'fetch'>
}

export interface OpenRPCClientServerTest<T extends AnyRouter, TClientContext extends ClientContext> {
  client: OpenRPCClient<RouterClient<T, TClientContext>>
  /**
   * The link behind `client`, to create clients of other types, such as one restoring native types.
   */
  link: OpenRPCLink<TClientContext>
  /**
   * Server origin, e.g. `http://localhost:1234`.
   */
  origin: string
  /**
   * Absolute URL of the JSON-RPC endpoint (`${origin}${OPENRPC_PREFIX}`).
   */
  url: string
  /**
   * The `fetch` of the link, which forwards to the real server.
   */
  fetchSpy: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>
}

export interface CreateOpenRPCClientServerTest {
  <T extends AnyRouter, TClientContext extends ClientContext = Record<never, never>>(
    router: T,
    options?: OpenRPCClientServerTestOptions<TClientContext>,
  ): OpenRPCClientServerTest<T, TClientContext>
}
