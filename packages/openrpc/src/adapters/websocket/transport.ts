import type { ClientContext, ClientOptions } from '@orpc/client'
import type { StandardLinkTransport } from '@orpc/client/standard'
import type { WebSocketLike } from '@orpc/client/websocket'
import type { Promisable } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { JsonRpcId, JsonRpcRequest } from '../../json-rpc'
import { AbortError, getOwn, isPlainObject, loadBytes, promiseWithResolvers, runWithSignal, sequential, stringifyJSON, toArray, toStringOrBytes } from '@orpc/shared'
import { parseJsonMessage } from './utils'

/**
 * Some environments have no WebSocket global, like Node.js 20
 */
const WEBSOCKET_CONNECTING = 0 satisfies WebSocket['CONNECTING']
const WEBSOCKET_OPEN = 1 satisfies WebSocket['OPEN']

export interface OpenRPCWebSocketLinkTransportOptions {
  /**
   * Returns the WebSocket to send calls on. Called on the first call, and again for the next call
   * once the previous socket has closed.
   */
  connect: () => Promisable<WebSocketLike>
}

interface Connection {
  websocket: WebSocketLike
  /**
   * The calls waiting for their response, by request id.
   */
  pending: Map<JsonRpcId, ReturnType<typeof promiseWithResolvers<unknown>>>
}

/**
 * Sends JSON-RPC requests as WebSocket messages, and matches the responses to them by `id`.
 */
export class OpenRPCWebSocketLinkTransport<T extends ClientContext> implements StandardLinkTransport<T> {
  private readonly connect: OpenRPCWebSocketLinkTransportOptions['connect']
  private connection: Promise<Connection> | undefined

  constructor(options: OpenRPCWebSocketLinkTransportOptions) {
    this.connect = options.connect
  }

  async send(request: StandardRequest, _path: string[], _options: ClientOptions<T>): Promise<StandardLazyResponse> {
    const { websocket, pending } = await runWithSignal(request.signal, () => this.getConnection())
    const id = (request.body as JsonRpcRequest).id ?? null
    const call = promiseWithResolvers<unknown>()

    pending.set(id, call)

    try {
      // checks the signal again before sending, and stops waiting once it aborts
      const body = await runWithSignal(request.signal, async () => {
        websocket.send(stringifyJSON(request.body)!)
        return call.promise
      })

      return { status: 200, headers: {}, resolveBody: async () => body }
    }
    finally {
      // also drops the call when it aborts or `send` throws, so closing the socket later does not reject it unawaited
      pending.delete(id)
    }
  }

  private getConnection(): Promise<Connection> {
    this.connection ??= this.open().catch((error) => {
      this.connection = undefined
      throw error
    })

    return this.connection
  }

  private async open(): Promise<Connection> {
    const websocket = await this.connect()

    if (websocket.readyState !== WEBSOCKET_CONNECTING && websocket.readyState !== WEBSOCKET_OPEN) {
      throw new AbortError('WebSocket is already closing or closed')
    }

    const pending: Connection['pending'] = new Map()
    const opened = websocket.readyState === WEBSOCKET_CONNECTING ? promiseWithResolvers<void>() : undefined

    if (opened) {
      websocket.addEventListener('open', () => opened.resolve())
    }

    // loading a `Blob` is async, so `sequential` keeps the messages in arrival order
    websocket.addEventListener('message', sequential(async (event: MessageEvent) => {
      const data = event.data instanceof Blob ? await loadBytes(event.data) : toStringOrBytes(event.data)

      // unparsable messages and responses to unknown ids are ignored
      for (const response of toArray(parseJsonMessage(data))) {
        if (isPlainObject(response)) {
          pending.get(getOwn(response, 'id') as JsonRpcId)?.resolve(response)
        }
      }
    }))

    websocket.addEventListener('close', (event: CloseEvent) => {
      const error = new AbortError(`WebSocket closed (code ${event.code}: ${event.reason})`)
      this.connection = undefined
      opened?.reject(error)

      for (const call of pending.values()) {
        call.reject(error)
      }
    })

    // EventEmitter-based implementations like `ws` throw an unhandled `error` event. `close` always follows and handles cleanup.
    websocket.addEventListener('error', () => {})

    await opened?.promise

    return { websocket, pending }
  }
}
