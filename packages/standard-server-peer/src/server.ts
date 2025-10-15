import type { AsyncIdQueueCloseOptions } from '@orpc/shared'
import type { StandardRequest, StandardResponse } from '@orpc/standard-server'
import type { DecodedRequestMessage, EventIteratorPayload } from './codec'
import type { EncodedMessageSendFn } from './types'
import { AbortError, AsyncIdQueue, getGlobalOtelConfig, isAsyncIteratorObject, runWithSpan } from '@orpc/shared'
import { HibernationEventIterator, isEventIteratorHeaders } from '@orpc/standard-server'
import { encodeResponseMessage, MessageType } from './codec'
import { resolveEventIterator, toEventIterator } from './event-iterator'

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
  /**
   * Queue of event iterator messages sent from client, awaiting consumption
   */
  private readonly clientEventIteratorQueue = new AsyncIdQueue<EventIteratorPayload>()
  /**
   * Map of active client request controllers, should be synced to request signal
   */
  private readonly clientControllers = new Map<string, AbortController>()

  private readonly send: (...args: Parameters<typeof encodeResponseMessage>) => Promise<void>

  constructor(
    send: EncodedMessageSendFn,
  ) {
    this.send = (id, ...rest) => encodeResponseMessage(id, ...rest).then(async (raw) => {
      // only send message if still open
      if (this.clientControllers.has(id)) {
        await send(raw)
      }
    })
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
    message: DecodedRequestMessage,
    handleRequest?: ServerPeerHandleRequestFn,
  ): Promise<[id: string, StandardRequest | undefined]> {
    const [id, type, payload] = message

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
                await this.send(id, MessageType.ABORT_SIGNAL, undefined)
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
      await this.send(id, MessageType.RESPONSE, response)

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

            await this.send(id, MessageType.EVENT_ITERATOR, payload)

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
