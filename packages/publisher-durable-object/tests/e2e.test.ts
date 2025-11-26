import type { RouterClient } from '../../server/src/router-client'
import type { router } from './e2e'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import worker from './e2e'

describe('hello World worker', () => {
  const createClient = (): RouterClient<typeof router> => {
    return createORPCClient(new RPCLink({
      url: 'http://example.com',
      fetch: async (request: Request) => {
        const response = await worker.fetch(request as any, env as any)
        return response
      },
    }))
  }

  it('simple publish/subscribe', async () => {
    const room = `room-${Math.random()}`
    const controller = new AbortController()
    const client = createClient()

    const messages: string[] = []
    const subscribePromise = (async () => {
      const subscription = await client.subscribe({ room }, { signal: controller.signal })
      try {
        for await (const event of subscription) {
          messages.push(event.message)
        }
      }
      catch {}
    })()

    await client.publish({ room, message: 'Hello' })
    await client.publish({ room, message: 'World' })

    await vi.waitFor(() => {
      expect(messages).toEqual(['Hello', 'World'])
    })

    controller.abort()
    await subscribePromise
  })

  it('multiple subscribers', async () => {
    const room = `room-${Math.random()}`
    const controller = new AbortController()
    const client = createClient()

    const messagesA: string[] = []
    const subscribePromiseA = (async () => {
      const subscription = await client.subscribe({ room }, { signal: controller.signal })
      try {
        for await (const event of subscription) {
          messagesA.push(event.message)
        }
      }
      catch {}
    })()

    await client.publish({ room, message: 'Hello' })

    const messagesB: string[] = []
    const subscribePromiseB = (async () => {
      const subscription = await client.subscribe({ room }, { signal: controller.signal })
      try {
        for await (const event of subscription) {
          messagesB.push(event.message)
        }
      }
      catch {}
    })()

    await client.publish({ room, message: 'World' })
    await client.publish({ room, message: '!' })

    await vi.waitFor(() => {
      expect(messagesA).toEqual(['Hello', 'World', '!'])
      expect(messagesB).toEqual(['World', '!'])
    })

    controller.abort()
    await subscribePromiseA
    await subscribePromiseB
  })

  it('resume subscription', async () => {
    const room = `room-${Math.random()}`
    const controller = new AbortController()
    const client = createClient()

    const messagesA: string[] = []
    const subscribePromiseA = (async () => {
      const subscription = await client.subscribe({ room }, { signal: controller.signal })
      try {
        for await (const event of subscription) {
          messagesA.push(event.message)
        }
      }
      catch {}
    })()

    await client.publish({ room, message: 'Hello' })
    await client.publish({ room, message: 'World' })

    const messagesB: string[] = []
    const subscribePromiseB = (async () => {
      const subscription = await client.subscribe({ room }, { signal: controller.signal, lastEventId: '1' })
      try {
        for await (const event of subscription) {
          messagesB.push(event.message)
        }
      }
      catch {}
    })()

    await client.publish({ room, message: '1' })
    await client.publish({ room, message: '2' })
    await client.publish({ room, message: '3' })

    await vi.waitFor(() => {
      expect(messagesA).toEqual(['Hello', 'World', '1', '2', '3'])
      expect(messagesB).toEqual(['World', '1', '2', '3'])
    })

    controller.abort()
    await subscribePromiseA
    await subscribePromiseB
  })
})
