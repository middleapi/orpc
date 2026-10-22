import type { AnyProcedure } from '../procedure'
import { AbortError, promiseWithResolvers } from '@orpc/shared'
import { RPCHandler } from '../adapters/fetch'
import { os } from '../builder'
import { SignalSyncHandlerPlugin } from './signal-sync'
import { TimeoutHandlerPlugin } from './timeout'

describe('signalSyncHandlerPlugin', () => {
  async function handle(procedure: AnyProcedure, init?: RequestInit): Promise<Response> {
    const handler = new RPCHandler(procedure, { plugins: [new SignalSyncHandlerPlugin()] })
    const { response } = await handler.handle(new Request('http://localhost', { method: 'POST', ...init }))
    return response!
  }

  function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
    return new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, text: string): Promise<void> {
    const decoder = new TextDecoder()
    let received = ''

    while (!received.includes(text)) {
      const { done, value } = await reader.read()

      if (done) {
        throw new Error(`Stream ended before receiving ${text}`)
      }

      received += decoder.decode(value, { stream: true })
    }
  }

  it('should abort the signal and stop the procedure when an event iterator body is cancelled', async () => {
    let signal: AbortSignal | undefined
    let waiting = false
    let cleaned = false

    const response = await handle(os.handler(async function* (options) {
      signal = options.signal

      try {
        yield 'first'
        waiting = true
        await waitForAbort(signal)
      }
      finally {
        cleaned = true
      }
    }))

    const reader = response.body!.getReader()
    await readUntil(reader, 'first')

    // a pending read makes the generator block on the signal, like an adapter writing the body
    const pendingRead = reader.read()
    await vi.waitFor(() => expect(waiting).toBe(true))
    expect(signal?.aborted).toBe(false)

    await reader.cancel()
    await expect(pendingRead).resolves.toEqual({ done: true, value: undefined })

    await vi.waitFor(() => expect(cleaned).toBe(true))
    expect(signal?.reason).toBeInstanceOf(AbortError)
    expect(signal?.reason.message).toBe('The response body was cancelled')
  })

  it('should abort the signal before cancelling a readable stream body', async () => {
    const cancel = vi.fn()

    const response = await handle(os.handler(({ signal }) => new ReadableStream({
      cancel(reason) {
        cancel(reason, signal?.reason)
      },
    })))

    await response.body!.cancel()

    const reason = cancel.mock.calls[0]?.[0]
    expect(reason).toBeInstanceOf(AbortError)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason, reason)
  })

  it('should end an event iterator body with an error event and cancel it when the signal aborts', async () => {
    const { promise: release, resolve } = promiseWithResolvers<void>()
    let waiting = false
    let cleaned = false

    const controller = new AbortController()
    const response = await handle(os.handler(async function* () {
      try {
        yield 'first'
        waiting = true
        await release // ignores the signal
        yield 'second'
      }
      finally {
        cleaned = true
      }
    }), { signal: controller.signal })

    const textPromise = response.text()
    await vi.waitFor(() => expect(waiting).toBe(true))
    controller.abort()

    const text = await textPromise
    expect(text).toContain('first')
    expect(text).toContain('event: error')
    expect(text).not.toContain('second')

    resolve()
    await vi.waitFor(() => expect(cleaned).toBe(true))
  })

  it('should error a readable stream body with the abort reason and cancel it when the signal aborts', async () => {
    const cancel = vi.fn()

    const controller = new AbortController()
    const response = await handle(os.handler(() => new ReadableStream({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('first'))
      },
      cancel,
    })), { signal: controller.signal })

    const reader = response.body!.getReader()
    await expect(reader.read()).resolves.toEqual({ done: false, value: new TextEncoder().encode('first') })

    const reason = new Error('timed out')
    controller.abort(reason)

    await expect(reader.read()).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
  })

  it('should end the output right away when the signal aborts before the procedure returns', async () => {
    const cancel = vi.fn()
    const reason = new Error('timed out')

    const controller = new AbortController()
    const response = await handle(os.handler(() => {
      controller.abort(reason)
      return new ReadableStream({ cancel })
    }), { signal: controller.signal })

    await expect(response.body!.getReader().read()).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
  })

  it.each([
    ['before', false],
    ['after', true],
  ])('should end streaming responses on streamingTimeout when registered %s the timeout plugin', async (_, reverse) => {
    const { promise: release, resolve } = promiseWithResolvers<void>()
    const plugins = [
      new SignalSyncHandlerPlugin(),
      new TimeoutHandlerPlugin({ timeout: null, streamingTimeout: 50 }),
    ]

    const handler = new RPCHandler(os.handler(async function* () {
      yield 'first'
      await release // ignores the signal
      yield 'second'
    }), {
      plugins: reverse ? plugins.reverse() : plugins,
    })

    const { response } = await handler.handle(new Request('http://localhost', { method: 'POST' }))
    const text = await response!.text()

    expect(text).toContain('first')
    expect(text).toContain('event: error')
    expect(text).not.toContain('second')
    resolve()
  })

  it.each([
    ['an event iterator body finishes', async function* () {
      yield 'first'
    }],
    ['an event iterator body ends with an error', async function* () {
      yield 'first'
      throw new Error('something went wrong')
    }],
    ['a readable stream body finishes', () => new Blob(['first']).stream()],
    ['the response is not streaming', () => 'first'],
  ])('should not abort the signal when %s', async (_, output) => {
    let signal: AbortSignal | undefined

    const response = await handle(os.handler((options) => {
      signal = options.signal
      return output()
    }))

    await expect(response.text()).resolves.toContain('first')
    expect(signal?.aborted).toBe(false)
  })

  it('should not abort the signal when a readable stream body errors', async () => {
    let signal: AbortSignal | undefined
    const error = new Error('read failed')

    const response = await handle(os.handler((options) => {
      signal = options.signal
      return new ReadableStream({
        pull() {
          throw error
        },
      })
    }))

    await expect(response.body!.getReader().read()).rejects.toBe(error)
    expect(signal?.aborted).toBe(false)
  })

  it('should forward aborts from the request signal', async () => {
    let signal: AbortSignal | undefined

    const controller = new AbortController()
    const promise = handle(os.handler(async (options) => {
      signal = options.signal
      await waitForAbort(signal)
    }), { signal: controller.signal })

    await vi.waitFor(() => expect(signal).toBeDefined())
    const reason = new Error('user cancelled')
    controller.abort(reason)

    expect((await promise).status).toBe(500)
    expect(signal?.reason).toBe(reason)
  })
})
