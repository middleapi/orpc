import type { AddressInfo } from 'node:net'
import type { Locker } from '../src'
import { createServer } from 'node:http'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { RPCHandler as NodeRPCHandler } from '@orpc/server/node'
import { promiseWithResolvers, sleep } from '@orpc/shared'
import { z } from 'zod'
import { lock, LockTimeoutError } from '../src'
import { MemoryLocker } from '../src/adapters/memory'

it('works', async () => {
  let active = 0
  let maxActive = 0

  const router = {
    generate: os
      .$context<{ locker: Locker }>()
      .input(z.object({ id: z.string() }))
      .use(
        lock({
          locker: ({ context }) => context.locker,
          key: (_, input) => `report:${input.id}`,
          timeout: 100,
        }),
      )
      .handler(async ({ context }) => {
        active++
        maxActive = Math.max(maxActive, active)
        await sleep(20)
        active--

        return { waited: context['lock/waited'] }
      }),
  }

  const handler = new RPCHandler(router)
  const locker = new MemoryLocker()

  const request = (id: string) => new Request('https://example.com/generate', {
    method: 'POST',
    body: JSON.stringify({ json: { id } }),
    headers: {
      'Content-Type': 'application/json',
    },
  })

  const [first, second] = await Promise.all([
    handler.handle(request('1'), { context: { locker } }),
    handler.handle(request('1'), { context: { locker } }),
  ])

  expect(first.response?.status).toBe(200)
  expect(second.response?.status).toBe(200)
  await expect(first.response?.json()).resolves.toMatchObject({ json: { waited: false } })
  await expect(second.response?.json()).resolves.toMatchObject({ json: { waited: true } })
  expect(maxActive).toBe(1)

  const { promise: release, resolve } = promiseWithResolvers<void>()
  const holder = locker.lock('report:2', () => release)

  const { response } = await handler.handle(request('2'), { context: { locker } })

  expect(response?.status).toBe(409)
  await expect(response?.json()).resolves.toMatchObject({ json: { code: 'CONFLICT' } })

  resolve()
  await holder
})

it('holds the lock for a whole event stream and releases it once the client disconnects', async () => {
  const locker = new MemoryLocker()
  const cleanup = vi.fn()

  const router = {
    stream: os
      .use(lock({ locker, key: 'stream' }))
      .handler(async function* () {
        try {
          while (true) {
            yield 'tick'
            await sleep(10)
          }
        }
        finally {
          cleanup()
        }
      }),
  }

  const isLocked = () => locker.lock('stream', () => false, { timeout: 0 }).catch((error) => {
    if (error instanceof LockTimeoutError) {
      return true
    }

    throw error
  })

  const handler = new NodeRPCHandler(router)
  const server = createServer(async (req, res) => {
    await handler.handle(req, res, { context: {} })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const { port } = server.address() as AddressInfo
    const controller = new AbortController()
    const response = await fetch(`http://127.0.0.1:${port}/stream`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''

    while (!received.includes('tick')) {
      const { done, value } = await reader.read()
      expect(done).toBe(false)
      received += decoder.decode(value)
    }

    // Still streaming, so the lock is still held
    await sleep(30)
    await expect(isLocked()).resolves.toBe(true)
    expect(cleanup).not.toHaveBeenCalled()

    controller.abort()

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await isLocked()).toBe(false))
  }
  finally {
    server.close()
  }
})
