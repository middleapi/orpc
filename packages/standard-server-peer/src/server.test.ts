import { isAsyncIteratorObject } from '@orpc/shared'
import { getEventMeta, HibernationEventIterator, withEventMeta } from '@orpc/standard-server'
import { decodeRequestMessage, decodeResponseMessage, encodeRequestMessage, MessageType } from './codec'
import { ServerPeer } from './server'

describe('serverPeer', () => {
  const REQUEST_ID = '1953'

  const send = vi.fn()
  const handle = vi.fn()
  let peer: ServerPeer

  beforeEach(() => {
    send.mockReset()
    handle.mockReset()
    peer = new ServerPeer(send)
  })

  afterEach(() => {
    expect(peer.length).toBe(0)
  })

  const baseRequest = {
    url: new URL('https://example.com'),
    method: 'POST',
    headers: {
      'x-request': '1',
    },
    body: { hello: 'world' },
    signal: undefined,
  }

  const baseResponse = {
    status: 200,
    headers: {
      'x-response': '1',
    },
    body: { hello: 'world_2' },
  }

  it('simple request/response', async () => {
    handle.mockResolvedValueOnce(baseResponse)

    const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
    const decoded = await decodeRequestMessage(encoded)
    await peer.message(decoded, handle)

    expect(send).toHaveBeenCalledTimes(1)
    expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, baseResponse])

    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('multiple simple request/response', async () => {
    handle.mockResolvedValueOnce(baseResponse)
    const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
    const decoded = await decodeRequestMessage(encoded)
    const [id, request] = await peer.message(decoded, handle)

    handle.mockResolvedValueOnce({ ...baseResponse, body: '__SECOND__' })
    const encoded2 = await encodeRequestMessage(REQUEST_ID + 1, MessageType.REQUEST, { ...baseRequest, body: '__SECOND__' })
    const decoded2 = await decodeRequestMessage(encoded2)
    const [id2, request2] = await peer.message(decoded2, handle)

    expect(id).toBe(REQUEST_ID)
    expect(request).toEqual({
      ...baseRequest,
      signal: expect.any(AbortSignal),
    })

    expect(id2).toBe(REQUEST_ID + 1)
    expect(request2).toEqual({
      ...baseRequest,
      body: '__SECOND__',
      signal: expect.any(AbortSignal),
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, baseResponse])
    expect(await decodeResponseMessage(send.mock.calls[1]![0])).toEqual([REQUEST_ID + 1, MessageType.RESPONSE, { ...baseResponse, body: '__SECOND__' }])

    expect(handle).toHaveBeenCalledTimes(2)
  })

  describe('request', () => {
    it('signal', async () => {
      handle.mockImplementationOnce(async (request) => {
        expect(request.signal.aborted).toBe(false)
        const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.ABORT_SIGNAL, undefined)
        const decoded = await decodeRequestMessage(encoded)
        await peer.message(decoded)
        expect(request.signal.aborted).toBe(true)
        return baseResponse
      })

      const encoded2 = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded2 = await decodeRequestMessage(encoded2)
      await peer.message(decoded2, handle)

      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('iterator', async () => {
      const clientRequest = {
        ...baseRequest,
        body: (async function* () {})(),
      }

      handle.mockImplementationOnce(async (request) => {
        const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' })
        const decoded = await decodeRequestMessage(encoded)
        await peer.message(decoded)

        const encoded2 = await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: { hello2: true }, meta: { id: 'id-1' } })
        const decoded2 = await decodeRequestMessage(encoded2)
        await peer.message(decoded2)

        const encoded3 = await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'done', data: 'hello3' })
        const decoded3 = await decodeRequestMessage(encoded3)
        await peer.message(decoded3)

        expect(request).toEqual({
          ...clientRequest,
          headers: {
            ...clientRequest.headers,
            'content-type': 'text/event-stream',
          },
          body: expect.toSatisfy(isAsyncIteratorObject),
          signal: expect.any(AbortSignal),
        })

        const iterator = request!.body as AsyncGenerator

        await expect(iterator.next()).resolves.toSatisfy(({ done, value }) => {
          expect(done).toBe(false)
          expect(value).toEqual('hello')

          return true
        })

        await expect(iterator.next()).resolves.toSatisfy(({ done, value }) => {
          expect(done).toBe(false)
          expect(value).toEqual({ hello2: true })
          expect(getEventMeta(value)).toEqual({ id: 'id-1' })

          return true
        })

        await expect(iterator.next()).resolves.toSatisfy(({ done, value }) => {
          expect(done).toBe(true)
          expect(value).toEqual('hello3')

          return true
        })

        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })

        return baseResponse
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(send).toHaveBeenCalledTimes(1)
    })

    it('iterator with manually .return', async () => {
      const clientRequest = {
        ...baseRequest,
        body: (async function* () { })(),
      }

      handle.mockImplementationOnce(async (request) => {
        const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' })
        const decoded = await decodeRequestMessage(encoded)
        await peer.message(decoded)

        expect(request).toEqual({
          ...clientRequest,
          headers: {
            ...clientRequest.headers,
            'content-type': 'text/event-stream',
          },
          body: expect.toSatisfy(isAsyncIteratorObject),
          signal: expect.any(AbortSignal),
        })

        const iterator = request!.body as AsyncGenerator

        await expect(iterator.next()).resolves.toSatisfy(({ done, value }) => {
          expect(done).toBe(false)
          expect(value).toEqual('hello')

          return true
        })

        await expect(iterator.return(undefined)).resolves.toEqual({ done: true, value: undefined })
        await expect(iterator.next(undefined)).resolves.toEqual({ done: true, value: undefined })

        expect(send).toHaveBeenCalledTimes(1)
        expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.ABORT_SIGNAL, undefined])

        return baseResponse
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(send).toHaveBeenCalledTimes(2)
      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('iterator with manually .throw', async () => {
      const clientRequest = {
        ...baseRequest,
        body: (async function* () { })(),
      }

      handle.mockImplementationOnce(async (request) => {
        const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' })
        const decoded = await decodeRequestMessage(encoded)
        await peer.message(decoded)

        expect(request).toEqual({
          ...clientRequest,
          headers: {
            ...clientRequest.headers,
            'content-type': 'text/event-stream',
          },
          body: expect.toSatisfy(isAsyncIteratorObject),
          signal: expect.any(AbortSignal),
        })

        const iterator = request!.body as AsyncGenerator

        await expect(iterator.next()).resolves.toSatisfy(({ done, value }) => {
          expect(done).toBe(false)
          expect(value).toEqual('hello')

          return true
        })

        await expect(iterator.throw(new Error('some error'))).rejects.toThrow('some error')
        await expect(iterator.next(undefined)).resolves.toEqual({ done: true, value: undefined })

        expect(send).toHaveBeenCalledTimes(1)
        expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.ABORT_SIGNAL, undefined])

        return baseResponse
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(send).toHaveBeenCalledTimes(2)
      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('file', async () => {
      const clientRequest = {
        ...baseRequest,
        body: new File(['hello'], 'hello.txt', { type: 'text/plain' }),
      }

      handle.mockImplementationOnce(async (request) => {
        expect(request).toEqual({
          ...clientRequest,
          headers: {
            ...clientRequest.headers,
            'content-type': 'text/plain',
            'content-disposition': expect.any(String),
          },
          signal: expect.any(AbortSignal),
        })

        return baseResponse
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('form data', async () => {
      const formData = new FormData()
      formData.append('hello', 'world')
      formData.append('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }))

      const clientRequest = {
        ...baseRequest,
        body: formData,
      }

      handle.mockImplementationOnce(async (request) => {
        expect(request).toEqual({
          ...clientRequest,
          headers: {
            ...clientRequest.headers,
            'content-type': expect.stringMatching(/^multipart\/form-data; boundary=/),
          },
          signal: expect.any(AbortSignal),
        })

        return baseResponse
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('handle throw error', async () => {
      handle.mockImplementationOnce(async () => {
        throw new Error('some error')
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await expect(peer.message(decoded, handle)).rejects.toThrow('some error')

      expect(handle).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledTimes(0)
    })
  })

  describe('response', () => {
    it('iterator', async () => {
      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: (async function* () {
          yield 'hello'
          yield withEventMeta({ hello2: true }, { id: 'id-1' })
          return withEventMeta({ hello3: true }, { retry: 2000 })
        })(),
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(4)
      expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, {
        ...baseResponse,
        headers: {
          ...baseResponse.headers,
          'content-type': 'text/event-stream',
        },
        body: undefined,
      }])
      expect(await decodeResponseMessage(send.mock.calls[1]![0]))
        .toEqual([REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' }])
      expect(await decodeResponseMessage(send.mock.calls[2]![0]))
        .toEqual([REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: { hello2: true }, meta: { id: 'id-1' } }])
      expect(await decodeResponseMessage(send.mock.calls[3]![0]))
        .toEqual([REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'done', data: { hello3: true }, meta: { retry: 2000 } }])
    })

    it('iterator with abort signal while sending', async () => {
      const yieldFn = vi.fn(v => v)
      let isFinallyCalled = false

      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: (async function* () {
          try {
            yield yieldFn('hello')
            await new Promise(resolve => setTimeout(resolve, 100))
            yield yieldFn('hello2')
            yield yieldFn('hello3')
          }
          finally {
            isFinallyCalled = true
          }
        })(),
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      const promise = peer.message(decoded, handle)

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(send).toHaveBeenCalledTimes(2)

      const encoded2 = await encodeRequestMessage(REQUEST_ID, MessageType.ABORT_SIGNAL, undefined)
      const decoded2 = await decodeRequestMessage(encoded2)
      await peer.message(decoded2)

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(send).toHaveBeenCalledTimes(2)

      expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, {
        ...baseResponse,
        headers: {
          ...baseResponse.headers,
          'content-type': 'text/event-stream',
        },
        body: undefined,
      }])
      expect(await decodeResponseMessage(send.mock.calls[1]![0]))
        .toEqual([REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' }])

      expect(yieldFn).toHaveBeenCalledTimes(2)
      expect(isFinallyCalled).toBe(true)

      await promise
      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('iterator throw non-ErrorEvent while consume', async () => {
      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: (async function* () {
          yield 'hello'
          throw new Error('some error')
        })(),
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await expect(peer.message(decoded, handle)).rejects.toThrow('some error')

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(3)
      expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, {
        ...baseResponse,
        headers: {
          ...baseResponse.headers,
          'content-type': 'text/event-stream',
        },
        body: undefined,
      }])
      expect(await decodeResponseMessage(send.mock.calls[1]![0]))
        .toEqual([REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' }])
      /**
       * Should send an error event even when the error is not an instance of ErrorEvent.
       */
      expect(await decodeResponseMessage(send.mock.calls[2]![0]))
        .toEqual([REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'error' }])
    })

    it('hibernation event iterator', async () => {
      const callback = vi.fn()

      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: new HibernationEventIterator(callback),
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(1)
      expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, {
        ...baseResponse,
        headers: {
          ...baseResponse.headers,
          'content-type': 'text/event-stream',
        },
        body: undefined,
      }])

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(REQUEST_ID)
    })

    it('file', async () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: file,
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(1)
      expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, {
        ...baseResponse,
        headers: {
          ...baseResponse.headers,
          'content-type': 'text/plain',
          'content-disposition': expect.any(String),
        },
        body: file,
      }])
    })

    it('form data', async () => {
      const formData = new FormData()
      formData.append('hello', 'world')
      formData.append('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }))

      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: formData,
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(1)
      expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, {
        ...baseResponse,
        headers: {
          ...baseResponse.headers,
          'content-type': expect.stringMatching(/^multipart\/form-data; boundary=/),
        },
        body: formData,
      }])
    })

    it('throw if can not send', async () => {
      send.mockImplementation(() => {
        throw new Error('send error')
      })

      handle.mockResolvedValueOnce(baseResponse)

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await expect(peer.message(decoded, handle)).rejects.toThrow('send error')

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(1)
      /**
       * ensure it not aborted if finished
       */
      expect(handle.mock.calls[0]![0].signal.aborted).toBe(false)
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('throw but not close if cannot manually stop iterator', async () => {
      send.mockRejectedValueOnce(new Error('send error'))

      handle.mockImplementationOnce(async (request) => {
        await expect((request as any).body.return()).rejects.toThrow('send error')
        expect(request.signal.aborted).toBe(false)
        return baseResponse
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, {
        ...baseRequest,
        body: (async function* () {})(),
      })
      const decoded = await decodeRequestMessage(encoded)
      await peer.message(decoded, handle)

      expect(handle).toHaveBeenCalledTimes(1)

      expect(send).toHaveBeenCalledTimes(2)
      expect(handle.mock.calls[0]![0].signal.aborted).toBe(false)
    })

    it('throw and close if cannot send iterator', async () => {
      let time = 0
      send.mockImplementation(() => {
        if (++time === 2) {
          throw new Error('send error')
        }
      })

      const yieldFn = vi.fn(v => v)
      let iteratorError
      let isFinallyCalled = false

      handle.mockResolvedValueOnce({
        ...baseResponse,
        body: (async function* () {
          try {
            yield yieldFn('hello')
            yield yieldFn('hello2')
            yield yieldFn('hello3')
          }
          catch (e) {
            iteratorError = e
          }
          finally {
            isFinallyCalled = true
            // eslint-disable-next-line no-unsafe-finally
            throw new Error('cleanup error')
          }
        })(),
      })

      const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
      const decoded = await decodeRequestMessage(encoded)
      await expect(peer.message(decoded, handle)).rejects.toThrow('cleanup error')

      expect(handle).toHaveBeenCalledTimes(1)

      expect(iteratorError).toBe(undefined)
      expect(yieldFn).toHaveBeenCalledTimes(1)
      expect(isFinallyCalled).toBe(true)

      expect(send).toHaveBeenCalledTimes(2)
      expect(handle.mock.calls[0]![0].signal.aborted).toBe(false)
    })
  })

  it('close all', async () => {
    handle.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      peer.close()
    })

    const encoded = await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest)
    const decoded = await decodeRequestMessage(encoded)
    const encoded2 = await encodeRequestMessage(REQUEST_ID + 1, MessageType.REQUEST, baseRequest)
    const decoded2 = await decodeRequestMessage(encoded2)

    await Promise.all([
      peer.message(decoded, handle),
      peer.message(decoded2, handle),
    ])

    expect(handle).toHaveBeenCalledTimes(2)

    expect(handle.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(handle.mock.calls[1]![0].signal.aborted).toBe(true)

    expect(send).toHaveBeenCalledTimes(0)
  })
})
