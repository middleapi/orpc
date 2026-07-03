import type { PublisherOptions, PublisherSubscribeListenerOptions } from '@orpc/publisher'
import type { Public } from '@orpc/shared'
import { RPCSerializer } from '@orpc/client'
import { Publisher } from '@orpc/publisher'
import { isTypescriptObject, stringifyJSON } from '@orpc/shared'
import { unwrapEvent, withEventMeta } from '@standardserver/core'

export interface DurablePublisherOptions extends PublisherOptions {
  /**
   * Prefix for events, to avoid naming conflicts with other publishers in the same Durable Object Namespace.
   *
   * @default ''
   */
  prefix?: string

  /**
   * Serializer for serialize and deserialize payloads.
   *
   * @default RPCSerializer
   */
  serializer?: undefined | Public<RPCSerializer>

  /**
   * Custom function to get the Durable Object stub for publishing.
   *
   * @default ((namespace, event) => namespace.getByName(event))
   */
  getStubByName?: (namespace: DurableObjectNamespace, event: string) => DurableObjectStub
}

export class DurablePublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly prefix: string
  private readonly serializer: Public<RPCSerializer>
  private readonly getStubByName: Exclude<DurablePublisherOptions['getStubByName'], undefined>

  constructor(
    private readonly namespace: DurableObjectNamespace<any>,
    { prefix, getStubByName, ...options }: DurablePublisherOptions = {},
  ) {
    super(options)
    this.prefix = prefix ?? ''
    this.serializer = options.serializer ?? new RPCSerializer()
    this.getStubByName = getStubByName ?? ((namespace, event) => namespace.getByName(event))
  }

  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const stub = this.getStubByName(this.namespace, this.prefix + event)

    const [data, meta] = unwrapEvent(payload)

    const response = await stub.fetch('http://localhost/publish', {
      method: 'POST',
      body: stringifyJSON({
        data: this.serializer.serialize(data),
        meta,
      }),
      headers: {
        'content-type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to publish event: ${response.status} ${response.statusText}`, {
        cause: response,
      })
    }
  }

  protected async subscribeListener<K extends keyof T & string>(event: K, listener: (payload: T[K]) => void, options?: PublisherSubscribeListenerOptions): Promise<() => Promise<void>> {
    const stub = this.getStubByName(this.namespace, this.prefix + event)

    const headers = new Headers({ upgrade: 'websocket' })
    if (options?.lastEventId !== undefined) {
      headers.set('last-event-id', options.lastEventId)
    }
    const response = await stub.fetch('http://localhost/subscribe', {
      headers,
    })

    const websocket = response.webSocket

    if (!websocket) {
      throw new Error('Failed to open subscription websocket to publisher durable object', {
        cause: response,
      })
    }

    websocket.addEventListener('message', (event) => {
      try {
        const serialized = JSON.parse(event.data)
        let payload = this.serializer.deserialize(serialized.data)
        if (isTypescriptObject(payload) && serialized.meta) {
          payload = withEventMeta(payload, serialized.meta)
        }

        listener(payload as T[K])
      }
      catch (error) {
        options?.onError?.(
          new Error('Failed to deserialize message from publisher durable object', {
            cause: error,
          }),
        )
      }
    })

    websocket.addEventListener('close', (event) => {
      if (event.code !== 1000 && event.code !== 1001) {
        options?.onError?.(
          new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason}`, {
            cause: event,
          }),
        )
      }
    })

    websocket.addEventListener('error', (event) => {
      options?.onError?.(
        new Error(`Subscription websocket error`, {
          cause: event,
        }),
      )
    })

    websocket.accept()

    return async () => {
      websocket.close()
    }
  }
}
