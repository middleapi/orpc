import type { ClientContext, ClientLink } from '@orpc/client'
import type { ClientRetryPluginContext } from '@orpc/client/plugins'
import type { StandardLinkOptions, StandardLinkPlugin } from '@orpc/client/standard'
import type { RPCLinkOptions } from '@orpc/client/websocket'
import type { ContractRouterClient } from '@orpc/contract'
import type { Promisable, Value } from '@orpc/shared'
import type { durableEventIteratorContract } from './contract'
import { createORPCClient } from '@orpc/client'
import { ClientRetryPlugin } from '@orpc/client/plugins'
import { RPCLink } from '@orpc/client/websocket'
import { toArray, value } from '@orpc/shared'
import { WebSocket as ReconnectableWebSocket } from 'partysocket'
import { DURABLE_EVENT_ITERATOR_PLUGIN_HEADER_KEY, DURABLE_EVENT_ITERATOR_PLUGIN_HEADER_VALUE, DURABLE_EVENT_ITERATOR_TOKEN_PARAM } from '../consts'
import { createClientDurableEventIterator } from './event-iterator'

export interface DurableEventIteratorLinkPluginContext {
  isDurableEventIteratorResponse?: boolean
}

export interface DurableEventIteratorLinkPluginOptions extends Omit<RPCLinkOptions<object>, 'websocket'> {
  /**
   * The WebSocket URL to connect to the Durable Event Iterator Object.
   */
  url: Value<Promisable<string | URL>>

  /**
   * Polyfill for WebSocket construction.
   */
  WebSocket?: typeof WebSocket
}

/**
 * @see {@link https://orpc.unnoq.com/docs/integrations/durable-event-iterator Durable Event Iterator Integration}
 */
export class DurableEventIteratorLinkPlugin<T extends ClientContext>
implements StandardLinkPlugin<T> {
  readonly CONTEXT_SYMBOL = Symbol('ORPC_DURABLE_EVENT_ITERATOR_LINK_PLUGIN_CONTEXT')
  order = 2_100_000

  private readonly url: DurableEventIteratorLinkPluginOptions['url']
  private readonly WebSocket: DurableEventIteratorLinkPluginOptions['WebSocket']
  private readonly linkOptions: Omit<RPCLinkOptions<object>, 'websocket'>

  constructor(opts: DurableEventIteratorLinkPluginOptions) {
    const { url, WebSocket, ...rest } = opts
    this.url = url
    this.WebSocket = WebSocket
    this.linkOptions = rest
  }

  init(options: StandardLinkOptions<T>): void {
    options.interceptors ??= []
    options.clientInterceptors ??= []

    // Mark responses that carry a DEI token
    options.clientInterceptors.push(async (clientOptions) => {
      const ctx = clientOptions.context[this.CONTEXT_SYMBOL] as DurableEventIteratorLinkPluginContext | undefined
      if (!ctx)
        throw new TypeError('[DurableEventIteratorLinkPlugin] Plugin context has been corrupted or modified by another plugin or interceptor')

      const res = await clientOptions.next()
      ctx.isDurableEventIteratorResponse = res.headers[DURABLE_EVENT_ITERATOR_PLUGIN_HEADER_KEY] === DURABLE_EVENT_ITERATOR_PLUGIN_HEADER_VALUE
      return res
    })

    // Turn the token into a resilient iterator (PartySocket-powered)
    options.interceptors.push(async (interceptorOptions) => {
      const pluginContext: DurableEventIteratorLinkPluginContext = {}
      const output = await interceptorOptions.next({
        ...interceptorOptions,
        context: {
          [this.CONTEXT_SYMBOL]: pluginContext,
          ...interceptorOptions.context,
        },
      })

      if (!pluginContext.isDurableEventIteratorResponse) {
        return output
      }

      // Token returned from this call (use once for the first connect)
      let initialToken = output as string

      // Save a snapshot of this exact call so we can re-fetch fresh tokens later
      const upstreamNext = interceptorOptions.next
      const snapshot = {
        path: interceptorOptions.path,
        input: interceptorOptions.input,
        context: { [this.CONTEXT_SYMBOL]: pluginContext, ...interceptorOptions.context },
        signal: interceptorOptions.signal,
        lastEventId: interceptorOptions.lastEventId,
      }

      const refetchToken = async (): Promise<string> => {
        const fresh = await upstreamNext(snapshot)
        // Server sets the header + returns the token string again.
        return fresh as string
      }

      const buildUrl = async (token: string): Promise<string> => {
        const u = new URL(await value(this.url))
        u.searchParams.set(DURABLE_EVENT_ITERATOR_TOKEN_PARAM, token)
        return u.toString()
      }

      // One PartySocket drives everything; its URL provider pulls tokens.
      let first = true
      const durableWs = new ReconnectableWebSocket(
        async () => {
          if (first) {
            first = false
            return buildUrl(initialToken)
          }
          const nextToken = await refetchToken()
          initialToken = nextToken // keep latest for visibility
          return buildUrl(nextToken)
        },
        undefined,
        {
          WebSocket: this.WebSocket,
        },
      )
      const durableLink = new RPCLink<ClientRetryPluginContext>({
        ...this.linkOptions,
        websocket: durableWs,
        plugins: [
          ...toArray(this.linkOptions.plugins),
          new ClientRetryPlugin(),
        ],
      })

      const durableClient: ContractRouterClient<typeof durableEventIteratorContract, ClientRetryPluginContext> = createORPCClient(durableLink)

      const iterator = await durableClient.subscribe(undefined, {
        context: {
          retry: Number.POSITIVE_INFINITY,
        },
      })

      const link: ClientLink<object> = {
        call(path, input, options) {
          return durableClient.call({
            path: path as [string, ...string[]], // server-side will ensure this is a valid path
            input,
          }, options)
        },
      }

      const durableIterator = createClientDurableEventIterator(iterator, link, {
        token: initialToken,
      })

      return durableIterator
    })
  }
}
