import type { StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type { PublisherOptions, PublisherSubscribeListenerOptions } from '@orpc/experimental-publisher'
import type { SerializedMessage } from './types'
import { StandardRPCJsonSerializer } from '@orpc/client/standard'
import { Publisher } from '@orpc/experimental-publisher'
import { isTypescriptObject, stringifyJSON } from '@orpc/shared'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'

export interface DurablePublisherOptions extends PublisherOptions, StandardRPCJsonSerializerOptions {
  /**
   * Prefix for events, to avoid naming conflicts with other publishers in the same Durable Object.
   *
   * @default ''
   */
  prefix?: string

  /**
   * Custom function to get the Durable Object stub for publishing.
   *
   * @default ((namespace, event) => namespace.getByName(event))
   */
  getStubByName?: (namespace: DurableObjectNamespace, event: string) => DurableObjectStub
}

export class DurablePublisher<T extends Record<string, object>> extends Publisher<T> {
  private readonly prefix: string
  private readonly serializer: StandardRPCJsonSerializer
  private readonly getStubByName: Exclude<DurablePublisherOptions['getStubByName'], undefined>

  constructor(
    private readonly namespace: DurableObjectNamespace<any>,
    { prefix, getStubByName, ...options }: DurablePublisherOptions = {},
  ) {
    super(options)
    this.prefix = prefix ?? ''
    this.serializer = new StandardRPCJsonSerializer(options)
    this.getStubByName = getStubByName ?? ((namespace, event) => namespace.getByName(event))
  }

  async publish<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    const stub = this.getStubByName(this.namespace, this.prefix + event)

    const [json_, meta_] = this.serializer.serialize(payload)
    const serialized: SerializedMessage = {
      data: { json: json_, meta: meta_ },
      meta: getEventMeta(payload),
    }

    const response = await stub.fetch('http://localhost/publish', {
      method: 'POST',
      body: stringifyJSON(serialized),
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

    websocket.addEventListener('message', async (event) => {
      try {
        let data: string
        if (event.data instanceof Blob) {
          data = await event.data.text()
        }
        else if (typeof event.data === 'string') {
          data = event.data
        }
        else {
          data = new TextDecoder().decode(event.data)
        }

        const serialized: SerializedMessage = JSON.parse(data)
        const payload = this.serializer.deserialize((serialized.data as any).json, (serialized.data as any).meta)
        const payloadWithMeta = isTypescriptObject(payload) && serialized.meta ? withEventMeta(payload, serialized.meta) : payload
        listener(payloadWithMeta as T[K])
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
