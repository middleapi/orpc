import type { StandardLazyResponse } from '@standard-server/core'
import { replicateLazyResponse } from './utils'

function makeResponse(resolveBody: StandardLazyResponse['resolveBody']): StandardLazyResponse {
  return { status: 200, headers: { 'x-custom': '1' }, resolveBody: vi.fn(resolveBody) }
}

describe('replicateLazyResponse', () => {
  it('resolves the body once and gives each replica its own stable copy', async () => {
    const response = makeResponse(async () => ({ list: [3, 1, 2] }))
    const [replica1, replica2] = replicateLazyResponse(response, [undefined, undefined])

    expect(replica1).toMatchObject({ status: 200, headers: { 'x-custom': '1' } })

    const [body1, body2] = await Promise.all([replica1!.resolveBody('json'), replica2!.resolveBody()])

    expect(response.resolveBody).toHaveBeenCalledTimes(1)
    expect(response.resolveBody).toHaveBeenCalledWith('json')
    expect(body1).toEqual({ list: [3, 1, 2] })
    expect(body2).toEqual({ list: [3, 1, 2] })
    expect(body1).not.toBe(body2)
    await expect(replica1!.resolveBody()).resolves.toBe(body1)
  })

  it('rejects every replica when resolving the body fails', async () => {
    const error = new Error('body failed')
    const [replica1, replica2] = replicateLazyResponse(makeResponse(async () => {
      throw error
    }), [undefined, undefined])

    await expect(replica1!.resolveBody()).rejects.toBe(error)
    await expect(replica2!.resolveBody()).rejects.toBe(error)
  })

  it('does not resolve the body for a replica whose signal is already aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('aborted')
    controller.abort(reason)

    const response = makeResponse(async () => 'body')
    const [replica] = replicateLazyResponse(response, [controller.signal, undefined])

    await expect(replica!.resolveBody()).rejects.toBe(reason)
    expect(response.resolveBody).not.toHaveBeenCalled()
  })

  describe('with signals', () => {
    it('passes readable stream chunks, completion, and errors through', async () => {
      const signals = [new AbortController().signal, new AbortController().signal]
      const [replica1, replica2] = replicateLazyResponse(makeResponse(async () => new ReadableStream({
        start(controller) {
          controller.enqueue('chunk')
          controller.close()
        },
      })), signals)

      for (const replica of [replica1!, replica2!]) {
        const reader = (await replica.resolveBody() as ReadableStream).getReader()
        await expect(reader.read()).resolves.toEqual({ done: false, value: 'chunk' })
        await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      }

      const error = new Error('stream failed')
      const [replica3] = replicateLazyResponse(makeResponse(async () => new ReadableStream({
        start(controller) {
          controller.error(error)
        },
      })), signals)

      const reader = (await replica3!.resolveBody() as ReadableStream).getReader()
      await expect(reader.read()).rejects.toBe(error)
    })

    it('releases a readable stream replica whose signal aborted before the body resolved', async () => {
      const controller = new AbortController()
      const cancel = vi.fn()
      const [replica1, replica2] = replicateLazyResponse(makeResponse(async () => new ReadableStream({
        pull(controller) {
          controller.enqueue('chunk')
        },
        cancel,
      })), [controller.signal, undefined])

      controller.abort(new Error('aborted'))
      const stream2 = await replica2!.resolveBody() as ReadableStream

      await expect(replica1!.resolveBody()).rejects.toThrow('aborted')

      const reader2 = stream2.getReader()
      await expect(reader2.read()).resolves.toEqual({ done: false, value: 'chunk' })
      expect(cancel).not.toHaveBeenCalled()

      await reader2.cancel()
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('passes async iterator events, completion, and errors through', async () => {
      const signals = [new AbortController().signal, new AbortController().signal]
      const [replica1, replica2] = replicateLazyResponse(makeResponse(async () => (async function* () {
        yield 'event'
        return 'done'
      })()), signals)

      for (const replica of [replica1!, replica2!]) {
        const iterator = await replica.resolveBody() as AsyncIterator<string>
        await expect(iterator.next()).resolves.toEqual({ done: false, value: 'event' })
        await expect(iterator.next()).resolves.toEqual({ done: true, value: 'done' })
      }

      const error = new Error('iterator failed')
      const [replica3] = replicateLazyResponse(makeResponse(async () => (async function* () {
        throw error
      })()), signals)

      const iterator = await replica3!.resolveBody() as AsyncIterator<string>
      await expect(iterator.next()).rejects.toBe(error)
    })
  })
})
