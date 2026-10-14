import type { MaybeOptionalOptions } from '@orpc/shared'
import type { DecodePeerMessageOptions, EncodePeerMessageOptions } from '@standard-server/peer'
import type { Message, Peer } from 'crossws'
import type { Context } from '../../context'
import type { FriendlyStandardHandlerHandleOptions, StandardHandler } from '../standard'
import type { StandardPeerGuardOptions } from '../standard-peer'
import { resolveMaybeOptionalOptions } from '@orpc/shared'
import { decodePeerMessage, encodePeerMessage, isClientPeerSendMessage, ServerPeer } from '@standard-server/peer'
import { createStandardPeerRequestHandler, StandardPeerGuard } from '../standard-peer'

export type CrosswsPeerLike = Pick<Peer, 'send'> & {
  /**
   * Bytes buffered but not yet transmitted (crossws >= 0.4).
   * Used for `sendHighWaterMark`, together with `waitForDrain`.
   */
  readonly bufferedAmount?: number | undefined

  /**
   * Resolves once `bufferedAmount` drops to `threshold` or the connection is no longer open (crossws >= 0.4).
   */
  waitForDrain?: ((options: { threshold?: number, signal?: AbortSignal }) => Promise<void>) | undefined

  readonly websocket?: { readonly readyState?: number | undefined } | undefined
}

export type CrosswsMessageLike = Pick<Message, 'rawData' | 'uint8Array'>

export interface experimental_CrosswsHandlerOptions<_T extends Context> extends StandardPeerGuardOptions {
  /**
   * Options for encoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  encodePeerMessage?: EncodePeerMessageOptions | undefined

  /**
   * Options for decoding peer messages. such as `prefix` for distinguishing messages on the same channel..
   */
  decodePeerMessage?: DecodePeerMessageOptions | undefined

  /**
   * Maximum number of bytes buffered on the connection but not yet transmitted before sending waits.
   * While a client does not read, streaming responses stop pulling from procedures, as over HTTP.
   *
   * Requires crossws >= 0.4 (`peer.bufferedAmount` and `peer.waitForDrain()`), otherwise sending never waits.
   * On Bun and uWebSockets.js, keep it below the runtime's own limit
   * (`backpressureLimit` / `maxBackpressure`), above which they drop messages.
   *
   * Set to `Infinity` to never wait.
   *
   * @default 1024 * 1024 (1 MiB)
   */
  sendHighWaterMark?: number | undefined
}

export class experimental_CrosswsHandler<T extends Context> {
  private readonly peers: WeakMap<CrosswsPeerLike, { peer: ServerPeer, guard: StandardPeerGuard }> = new WeakMap()
  private readonly encodePeerMessageOptions: experimental_CrosswsHandlerOptions<T>['encodePeerMessage']
  private readonly decodePeerMessageOptions: experimental_CrosswsHandlerOptions<T>['decodePeerMessage']
  private readonly guardOptions: StandardPeerGuardOptions

  constructor(
    private readonly handler: StandardHandler<T>,
    options: NoInfer<experimental_CrosswsHandlerOptions<T>> = {},
  ) {
    this.encodePeerMessageOptions = options.encodePeerMessage
    this.decodePeerMessageOptions = options.decodePeerMessage
    this.guardOptions = {
      maxConcurrentRequests: options.maxConcurrentRequests,
      maxBufferedStreamSize: options.maxBufferedStreamSize,
      sendHighWaterMark: options.sendHighWaterMark,
    }
  }

  /**
   * Handles a single WebSocket message.
   *
   * Message order matters. Call this immediately after receiving a message,
   * before any other async work, to preserve ordering.
   *
   * @param ws The crossws peer instance. Use the same instance for all messages.
   */
  async message(
    ws: CrosswsPeerLike,
    message: CrosswsMessageLike,
    ...rest: MaybeOptionalOptions<FriendlyStandardHandlerHandleOptions<T>>
  ): Promise<{ matched: boolean }> {
    let state = this.peers.get(ws)

    if (!state) {
      const guard = new StandardPeerGuard(this.guardOptions)
      const peer = new ServerPeer(async (message) => {
        const encoded = await encodePeerMessage(message, this.encodePeerMessageOptions)
        await guard.send(
          () => ws.send(encoded),
          () => getBufferedAmount(ws),
          async (threshold, signal) => ws.waitForDrain?.({ threshold, signal }),
        )
      })

      this.peers.set(ws, state = { peer, guard })
    }

    /**
     * Message order is important: loading -> decode -> .message.
     * This flow must stay synchronous, or we need to use `sequential` helper
     */
    const encodedMessage = typeof message.rawData === 'string' ? message.rawData : message.uint8Array() as Uint8Array<ArrayBuffer>
    const result = decodePeerMessage(encodedMessage, this.decodePeerMessageOptions)
    if (result.matched && isClientPeerSendMessage(result.message)) {
      await state.guard.message(
        state.peer,
        result.message,
        createStandardPeerRequestHandler(this.handler, resolveMaybeOptionalOptions(rest)),
        typeof encodedMessage === 'string' ? encodedMessage.length : encodedMessage.byteLength,
      )
    }

    return result
  }

  /**
   * Cleans up peer state for a closed WebSocket.
   *
   * @param ws The same crossws peer instance passed to `.message()`.
   */
  async close(ws: CrosswsPeerLike): Promise<void> {
    const state = this.peers.get(ws)

    if (state) {
      // delete before close to avoid potential race conditions
      this.peers.delete(ws)
      state.guard.close()
      await state.peer.close()
    }
  }
}

function getBufferedAmount(ws: CrosswsPeerLike): number | null | undefined {
  if (typeof ws.bufferedAmount !== 'number' || typeof ws.waitForDrain !== 'function') {
    return undefined
  }

  if ((ws.websocket?.readyState ?? 1) > 1) {
    return null
  }

  return ws.bufferedAmount
}
