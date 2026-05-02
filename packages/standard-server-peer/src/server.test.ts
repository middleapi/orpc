import { isAsyncIteratorObject } from '@orpc/shared'
import { getEventMeta, HibernationEventIterator, withEventMeta } from '@orpc/standard-server'
import { decodeResponseMessage, encodeRequestMessage, MessageType } from './codec'
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

    await peer.message(
      await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
      handle,
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(await decodeResponseMessage(send.mock.calls[0]![0])).toEqual([REQUEST_ID, MessageType.RESPONSE, baseResponse])

    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('multiple simple request/response', async () => {
    handle.mockResolvedValueOnce(baseResponse)
    const [id, request] = await peer.message(
      await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
      handle,
    )

    handle.mockResolvedValueOnce({ ...baseResponse, body: '__SECOND__' })
    const [id2, request2] = await peer.message(
      await encodeRequestMessage(REQUEST_ID + 1, MessageType.REQUEST, { ...baseRequest, body: '__SECOND__' }),
      handle,
    )

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
        await peer.message(await encodeRequestMessage(REQUEST_ID, MessageType.ABORT_SIGNAL, undefined))
        expect(request.signal.aborted).toBe(true)
        return baseResponse
      })

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('iterator', async () => {
      const clientRequest = {
        ...baseRequest,
        body: (async function* () {})(),
      }

      handle.mockImplementationOnce(async (request) => {
        await peer.message(
          await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' }),
        )
        await peer.message(
          await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: { hello2: true }, meta: { id: 'id-1' } }),
        )
        await peer.message(
          await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'done', data: 'hello3' }),
        )

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest),
        handle,
      )

      expect(send).toHaveBeenCalledTimes(1)
    })

    it('iterator with manually .return', async () => {
      const clientRequest = {
        ...baseRequest,
        body: (async function* () { })(),
      }

      handle.mockImplementationOnce(async (request) => {
        await peer.message(await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' }))

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest),
        handle,
      )

      expect(send).toHaveBeenCalledTimes(2)
      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('iterator with manually .throw', async () => {
      const clientRequest = {
        ...baseRequest,
        body: (async function* () { })(),
      }

      handle.mockImplementationOnce(async (request) => {
        await peer.message(await encodeRequestMessage(REQUEST_ID, MessageType.EVENT_ITERATOR, { event: 'message', data: 'hello' }))

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest),
        handle,
      )

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest),
        handle,
      )

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, clientRequest),
        handle,
      )

      expect(handle).toHaveBeenCalledTimes(1)
    })

    it('duplicate request message should be ignored', async () => {
      handle.mockImplementationOnce(async () => baseResponse)

      const promise = peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

      // Send duplicate while first request is still processing
      const [id, request] = await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

      expect(id).toBe(REQUEST_ID)
      expect(request).toBeUndefined()
      // handle should only be called once (duplicate ignored)
      expect(handle).toHaveBeenCalledTimes(1)

      const [id2, request2] = await promise
      expect(id2).toBe(REQUEST_ID)
      expect(request2).toEqual({
        ...baseRequest,
        signal: expect.any(AbortSignal),
      })

      expect(send).toHaveBeenCalledTimes(1)
    })

    it('handle throw error', async () => {
      handle.mockImplementationOnce(async () => {
        throw new Error('some error')
      })

      await expect(
        peer.message(
          await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
          handle,
        ),
      ).rejects.toThrow('some error')

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

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

      const promise = peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(send).toHaveBeenCalledTimes(2)

      await peer.message(await encodeRequestMessage(REQUEST_ID, MessageType.ABORT_SIGNAL, undefined))

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

      await expect(
        peer.message(
          await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
          handle,
        ),
      ).rejects.toThrow('some error')

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

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

      await peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )

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

      await expect(peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      )).rejects.toThrow('send error')

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

      await peer.message(await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, {
        ...baseRequest,
        body: (async function* () {})(),
      }), handle)

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

      await expect(
        peer.message(
          await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
          handle,
        ),
      ).rejects.toThrow('cleanup error')

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

    await Promise.all([
      peer.message(
        await encodeRequestMessage(REQUEST_ID, MessageType.REQUEST, baseRequest),
        handle,
      ),
      peer.message(
        await encodeRequestMessage(REQUEST_ID + 1, MessageType.REQUEST, baseRequest),
        handle,
      ),
    ])

    expect(handle).toHaveBeenCalledTimes(2)

    expect(handle.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(handle.mock.calls[1]![0].signal.aborted).toBe(true)

    expect(send).toHaveBeenCalledTimes(0)
  })
})
