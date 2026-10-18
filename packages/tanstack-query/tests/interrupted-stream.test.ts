import type { RouterClient } from '@orpc/server'
import type { EventStreamMessage } from '@standard-server/core'
import { createORPCClient, EventStreamIncompleteError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { encodeEventStreamMessage, EventStreamDecoderStream } from '@standard-server/core'
import { QueryClient } from '@tanstack/query-core'
import { createTanstackQueryUtils } from '../src'

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

const router = {
  counter: os.handler(async function* () {
    for (let count = 1; count <= 4; count++) {
      yield { count }
    }
  }),
}

const handler = new RPCHandler(router)

const client: RouterClient<typeof router> = createORPCClient(new RPCLink({
  origin: 'http://localhost',
  fetch: async (url, init) => {
    const { response } = await handler.handle(new Request(url, init))
    return cutShort(response!, 2)
  },
}))

const orpc = createTanstackQueryUtils(client)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

beforeEach(() => {
  queryClient.clear()
})

describe('stream cut short before its close event', () => {
  it('puts a streamed query in the error state, keeping the chunks received so far', async () => {
    const options = orpc.counter.streamedOptions()

    await expect(queryClient.fetchQuery(options)).rejects.toBeInstanceOf(EventStreamIncompleteError)

    const state = queryClient.getQueryState(options.queryKey)
    expect(state?.status).toBe('error')
    expect(state?.error).toBeInstanceOf(EventStreamIncompleteError)
    expect(state?.data).toEqual([{ count: 1 }, { count: 2 }])
  })

  it('puts a live query in the error state, keeping the last chunk received', async () => {
    const options = orpc.counter.liveOptions()

    await expect(queryClient.fetchQuery(options)).rejects.toBeInstanceOf(EventStreamIncompleteError)

    const state = queryClient.getQueryState(options.queryKey)
    expect(state?.status).toBe('error')
    expect(state?.error).toBeInstanceOf(EventStreamIncompleteError)
    expect(state?.data).toEqual({ count: 2 })
  })
})
