import type { AsyncIdQueueCloseOptions, Promisable } from '@orpc/shared'
import type { StandardRequest, StandardResponse } from '@orpc/standard-server'
import type { DecodedRequestMessage, DecodedResponseMessage, EventIteratorPayload } from './codec'
import type { EncodedMessage, EncodedMessageSendFn } from './types'
import { AbortError, AsyncIdQueue, getGlobalOtelConfig, isAsyncIteratorObject, runWithSpan } from '@orpc/shared'
import { HibernationEventIterator, isEventIteratorHeaders } from '@orpc/standard-server'
import { decodeRequestMessage, encodeResponseMessage, MessageType } from './codec'
import { resolveEventIterator, toEventIterator } from './event-iterator'

export interface experimental_ResponseMessageSendFn {
  (message: DecodedResponseMessage): Promisable<void>
}

export interface ServerPeerHandleRequestFn {
  (request: StandardRequest): Promise<StandardResponse>
}

export interface ServerPeerCloseOptions extends AsyncIdQueueCloseOptions {
  /**
   * Should abort or not?
   *
   * @default true
   */
  abort?: boolean
}

export class ServerPeer {
  private readonly peer: experimental_ServerPeerWithoutCodec

  constructor(
    send: EncodedMessageSendFn,
  ) {
    // eslint-disable-next-line new-cap
    this.peer = new experimental_ServerPeerWithoutCodec(async ([id, type, payload]) => {
      await send(await encodeResponseMessage(id, type, payload))
    })
  }

  get length(): number {
    return this.peer.length
  }

  open(id: string): AbortController {
    /* v8 ignore next 2 - alias */
    return this.peer.open(id)
  }

  /**
   * @todo This method will return Promise<void> in the next major version.
   */
  async message(
    raw: EncodedMessage,
    handleRequest?: ServerPeerHandleRequestFn,
  ): Promise<[id: string, StandardRequest | undefined]> {
    return this.peer.message(await decodeRequestMessage(raw), handleRequest)
  }

  /**
   * @deprecated Please pass the `handleRequest` (second arg) function to the `message` method instead.
   */
  async response(id: string, response: StandardResponse): Promise<void> {
    /* v8 ignore next 2 - alias */
    return this.peer.response(id, response)
  }

  close({ abort = true, ...options }: ServerPeerCloseOptions = {}): void {
    return this.peer.close({ ...options, abort })
  }
}

export class experimental_ServerPeerWithoutCodec {
  /**
   * Queue of event iterator messages sent from client, awaiting consumption
   */
  private readonly clientEventIteratorQueue = new AsyncIdQueue<EventIteratorPayload>()
  /**
   * Map of active client request controllers, should be synced to request signal
   */
  private readonly clientControllers = new Map<string, AbortController>()

  private readonly send: experimental_ResponseMessageSendFn

  constructor(
    send: experimental_ResponseMessageSendFn,
  ) {
    this.send = async (message) => {
      const id = message[0]
      // only send message if still open
      if (this.clientControllers.has(id)) {
        await send(message)
      }
    }
  }

  get length(): number {
    return (
      this.clientEventIteratorQueue.length
      + this.clientControllers.size
    ) / 2
  }

  open(id: string): AbortController {
    this.clientEventIteratorQueue.open(id)
    const controller = new AbortController()
    this.clientControllers.set(id, controller)
    return controller
  }

  /**
   * @todo This method will return Promise<void> in the next major version.
   */
  async message(
    [id, type, payload]: DecodedRequestMessage,
    handleRequest?: ServerPeerHandleRequestFn,
  ): Promise<[id: string, StandardRequest | undefined]> {
    if (type === MessageType.ABORT_SIGNAL) {
      this.close({ id, reason: new AbortError('Client aborted the request') })
      return [id, undefined]
    }

    if (type === MessageType.EVENT_ITERATOR) {
      if (this.clientEventIteratorQueue.isOpen(id)) {
        this.clientEventIteratorQueue.push(id, payload)
      }
      return [id, undefined]
    }

    const clientController = this.open(id)
    const signal = clientController.signal

    const request: StandardRequest = {
      ...payload,
      signal,
      body: isEventIteratorHeaders(payload.headers)
        ? toEventIterator(
            this.clientEventIteratorQueue,
            id,
            async (reason) => {
              if (reason !== 'next') {
                await this.send([id, MessageType.ABORT_SIGNAL, undefined])
              }
            },
            { signal },
          )
        : payload.body,
    }

    if (handleRequest) {
      let context
      const otelConfig = getGlobalOtelConfig()
      if (otelConfig) {
        context = otelConfig.propagation.extract(otelConfig.context.active(), request.headers)
      }

      await runWithSpan(
        { name: 'receive_peer_request', context },
        async () => {
          const response = await runWithSpan(
            { name: 'handle_request' },
            async () => {
              try {
                return await handleRequest(request)
              }
              catch (reason) {
                /**
                 * Always close the id if the request handler throws an error
                 * to prevent memory leaks.
                 */
                this.close({ id, reason, abort: false })
                throw reason
              }
            },
          )

          /**
           * No need to manually close the id on send failure;
           * the underlying send/response logic handles cleanup.
           */
          await runWithSpan(
            { name: 'send_peer_response' },
            () => this.response(id, response),
          )
        },
      )
    }

    return [id, request]
  }

  /**
   * @deprecated Please pass the `handleRequest` (second arg) function to the `message` method instead.
   */
  async response(id: string, response: StandardResponse): Promise<void> {
    const signal = this.clientControllers.get(id)?.signal

    // only send message if still open and not aborted
    if (!signal || signal.aborted) {
      return
    }

    try {
      /**
       * We should send response message before event iterator messages,
       * so the server can recognize them as part of the response.
       */
      await this.send([id, MessageType.RESPONSE, response])

      if (!signal.aborted && isAsyncIteratorObject(response.body)) {
        if (response.body instanceof HibernationEventIterator) {
          response.body.hibernationCallback?.(id)
        }
        else {
          const iterator = response.body

          await resolveEventIterator(iterator, async (payload) => {
            if (signal.aborted) {
              return 'abort'
            }

            await this.send([id, MessageType.EVENT_ITERATOR, payload])

            return 'next'
          })
        }
      }

      this.close({ id, abort: false })
    }
    catch (reason) {
      this.close({ id, reason, abort: false })
      throw reason
    }
  }

  close({ abort = true, ...options }: ServerPeerCloseOptions = {}): void {
    if (options.id === undefined) {
      if (abort) {
        this.clientControllers.forEach(c => c.abort(options.reason))
      }

      this.clientControllers.clear()
    }
    else {
      if (abort) {
        this.clientControllers.get(options.id)?.abort(options.reason)
      }

      this.clientControllers.delete(options.id)
    }

    this.clientEventIteratorQueue.close(options)
  }
}
