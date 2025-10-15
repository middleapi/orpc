import type { AsyncIdQueueCloseOptions } from '@orpc/shared'
import type { StandardRequest, StandardResponse } from '@orpc/standard-server'
import type { encodeRequestMessage, EventIteratorPayload } from './codec'
import type { AdapterSendFn, EncodedMessage, RequestOptions } from './types'
import { AsyncIdQueue, clone, getGlobalOtelConfig, isAsyncIteratorObject, runWithSpan, SequentialIdGenerator } from '@orpc/shared'
import { isEventIteratorHeaders } from '@orpc/standard-server'
import { decodeResponseMessage, MessageType } from './codec'
import { resolveEventIterator, toEventIterator } from './event-iterator'

export interface ClientPeerCloseOptions extends AsyncIdQueueCloseOptions {
  /**
   * Should abort or not?
   *
   * @default true
   */
  abort?: boolean
}

export class ClientPeer {
  private readonly idGenerator = new SequentialIdGenerator()

  /**
   * Queue of responses sent from server, awaiting consumption
   */
  private readonly responseQueue = new AsyncIdQueue<StandardResponse>()

  /**
   * Queue of event iterator messages sent from server, awaiting consumption
   */
  private readonly serverEventIteratorQueue = new AsyncIdQueue<EventIteratorPayload>()

  /**
   * Controllers used to signal that the client should stop sending event iterator messages
   */
  private readonly serverControllers = new Map<string, AbortController>()

  /**
   * Cleanup functions invoked when the request/response is closed
   */
  private readonly cleanupFns = new Map<string, (() => void)[]>()

  private readonly send: (...args: [...Parameters<typeof encodeRequestMessage>, options?: StructuredSerializeOptions]) => Promise<void>

  constructor(
    send: AdapterSendFn,
  ) {
    this.send = async (id, type, payload, options) => {
      // only send message if still open
      if (this.serverControllers.has(id)) {
        await send(id, type, payload, options)
      }
    }
  }

  get length(): number {
    return (
      +this.responseQueue.length
      + this.serverEventIteratorQueue.length
      + this.serverControllers.size
      + this.cleanupFns.size
    ) / 4
  }

  open(id: string): AbortController {
    this.serverEventIteratorQueue.open(id)
    this.responseQueue.open(id)
    const controller = new AbortController()
    this.serverControllers.set(id, controller)
    this.cleanupFns.set(id, [])
    return controller
  }

  async request(request: StandardRequest, options?: RequestOptions): Promise<StandardResponse> {
    const signal = request.signal

    return runWithSpan(
      { name: 'send_peer_request', signal },
      async () => {
        if (signal?.aborted) {
          throw signal.reason
        }

        const id = this.idGenerator.generate()
        const serverController = this.open(id)

        try {
          const otelConfig = getGlobalOtelConfig()

          if (otelConfig) {
            const headers = clone(request.headers)
            otelConfig.propagation.inject(otelConfig.context.active(), headers)
            request = { ...request, headers }
          }

          /**
           * We must ensure the request is sent before send any additional messages,
           * such as event iterator messages, signal messages, etc.
           * Otherwise, the server may not recognize them as part of the request.
           */
          await this.send(id, MessageType.REQUEST, request, options)

          if (signal?.aborted) {
            await this.send(id, MessageType.ABORT_SIGNAL, undefined)
            throw signal.reason
          }

          let abortListener: () => void
          signal?.addEventListener('abort', abortListener = async () => {
            await this.send(id, MessageType.ABORT_SIGNAL, undefined)
            this.close({ id, reason: signal.reason })
          }, { once: true })
          /**
           * Make sure to remove the abort listener when the request/response is closed.
           * Since a signal can be reused for multiple requests, if each request
           * adds listeners without removing them, it can lead to excessive memory usage
           * until the signal is garbage collected.
           */
          this.cleanupFns.get(id)?.push(() => {
            signal?.removeEventListener('abort', abortListener)
          })

          if (isAsyncIteratorObject(request.body)) {
            const iterator = request.body

            /**
             * Do not await here; we don't want it to block response processing.
             * Errors should be handled in the unhandledRejection channel.
             * Even if sending event iterator to the server fails,
             * the server can still send back a response.
             */
            void resolveEventIterator(iterator, async (payload) => {
              if (serverController.signal.aborted) {
                return 'abort'
              }

              await this.send(id, MessageType.EVENT_ITERATOR, payload)

              return 'next'
            })
          }

          const response = await this.responseQueue.pull(id)

          if (isEventIteratorHeaders(response.headers)) {
            const iterator = toEventIterator(
              this.serverEventIteratorQueue,
              id,
              async (reason) => {
                try {
                  if (reason !== 'next') {
                    await this.send(id, MessageType.ABORT_SIGNAL, undefined)
                  }
                }
                finally {
                  this.close({ id })
                }
              },
              { signal },
            )

            return {
              ...response,
              body: iterator,
            }
          }

          this.close({ id })
          return response
        }
        catch (err) {
          this.close({ id, reason: err })
          throw err
        }
      },
    )
  }

  async message(raw: EncodedMessage): Promise<void> {
    const [id, type, payload] = await decodeResponseMessage(raw)

    if (type === MessageType.ABORT_SIGNAL) {
      this.serverControllers.get(id)?.abort()
      return
    }

    if (type === MessageType.EVENT_ITERATOR) {
      if (this.serverEventIteratorQueue.isOpen(id)) {
        this.serverEventIteratorQueue.push(id, payload)
      }
      return
    }

    if (!this.responseQueue.isOpen(id)) {
      return
    }

    this.responseQueue.push(id, payload)
  }

  close(options: AsyncIdQueueCloseOptions = {}): void {
    if (options.id !== undefined) {
      this.serverControllers.get(options.id)?.abort(options.reason)
      this.serverControllers.delete(options.id)
      this.cleanupFns.get(options.id)?.forEach(fn => fn())
      this.cleanupFns.delete(options.id)
    }
    else {
      this.serverControllers.forEach(c => c.abort(options.reason))
      this.serverControllers.clear()
      this.cleanupFns.forEach(fns => fns.forEach(fn => fn()))
      this.cleanupFns.clear()
    }

    this.responseQueue.close(options)
    this.serverEventIteratorQueue.close(options)
  }
}
