import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import type { RouterClient } from '@orpc/server'
import type { EventStreamMessage } from '@standard-server/core'
import { createORPCClient, EventStreamIncompleteError, getEventMeta } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RetryLinkPlugin } from '@orpc/client/plugins'
import { os, withEventMeta } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { encodeEventStreamMessage, EventStreamDecoderStream } from '@standard-server/core'

/**
 * Ends the body cleanly after `count` messages, before its close event,
 * the way a proxy idle timeout or a serverless time limit cuts a stream short.
 */
function cutShort(response: Response, count: number): Response {
  let sent = 0

  const body = response.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventStreamDecoderStream())
    .pipeThrough(new TransformStream<EventStreamMessage, string>({
      transform(message, controller) {
        if (message.event !== 'message') {
          return
        }

        controller.enqueue(encodeEventStreamMessage(message))

        if (++sent === count) {
          controller.terminate()
        }
      },
    }))
    .pipeThrough(new TextEncoderStream())

  return new Response(body, response)
}

describe('interrupted event stream', () => {
  const router = {
    counter: os.handler(async function* ({ lastEventId }) {
      for (let count = Number(lastEventId ?? 0) + 1; count <= 4; count++) {
        yield withEventMeta({ count }, { id: String(count), retry: 10 })
      }
    }),
  }

  const handler = new RPCHandler(router)

  function createClient(
    cut: (request: Request, response: Response) => Response,
    plugins: RetryLinkPlugin<RetryLinkPluginContext>[] = [],
  ): RouterClient<typeof router, RetryLinkPluginContext> {
    return createORPCClient(new RPCLink<RetryLinkPluginContext>({
      origin: 'http://localhost',
      plugins,
      fetch: async (url, init) => {
        const request = new Request(url, init)
        const { response } = await handler.handle(request)
        return cut(request, response!)
      },
    }))
  }

  it('finishes a stream that ends with its close event', async () => {
    const client = createClient((_, response) => response)

    const counts: number[] = []
    for await (const event of await client.counter()) {
      counts.push(event.count)
    }

    expect(counts).toEqual([1, 2, 3, 4])
  })

  it('throws EventStreamIncompleteError carrying the last event id and retry', async () => {
    const client = createClient((_, response) => cutShort(response, 2))

    const iterator = await client.counter()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { count: 1 } })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { count: 2 } })
    await expect(iterator.next()).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(EventStreamIncompleteError)
      expect(getEventMeta(error)).toEqual({ id: '2', retry: 10 })
      return true
    })
  })

  it('reconnects with RetryLinkPlugin and resumes from the last event id', async () => {
    const lastEventIds: (string | null)[] = []

    const client = createClient((request, response) => {
      lastEventIds.push(request.headers.get('last-event-id'))
      // only the first connection is cut short
      return lastEventIds.length === 1 ? cutShort(response, 2) : response
    }, [new RetryLinkPlugin()])

    const counts: number[] = []
    for await (const event of await client.counter(undefined, { context: { retry: 1 } })) {
      counts.push(event.count)
    }

    expect(counts).toEqual([1, 2, 3, 4])
    expect(lastEventIds).toEqual([null, '2'])
  })
})
