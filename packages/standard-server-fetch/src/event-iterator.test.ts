import * as shared from '@orpc/shared'
import { ErrorEvent, getEventMeta, withEventMeta } from '@orpc/standard-server'
import { toEventIterator, toEventStream } from './event-iterator'

const isAsyncIteratorObject = shared.isAsyncIteratorObject
const startSpanSpy = vi.spyOn(shared, 'startSpan')
const runInSpanContextSpy = vi.spyOn(shared, 'runInSpanContext')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toEventIterator', () => {
  it('with done event', async () => {
    const stream = new ReadableStream<string>({
      async pull(controller) {
        controller.enqueue('event: message\ndata: {"order": 1}\nid: id-1\nretry: 10000\n\n')
        controller.enqueue('event: message\ndata: {"order": 2}\nid: id-2\n\n')
        controller.enqueue(': ping\n\n')
        controller.enqueue('event: done\ndata: {"order": 3}\nid: id-3\nretry: 30000\n\n')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    const generator = toEventIterator(stream)
    expect(generator).toSatisfy(isAsyncIteratorObject)

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-1', retry: 10000 }))

      return true
    })

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 2 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-2', retry: undefined }))

      return true
    })

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(true)
      expect(value).toEqual({ order: 3 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-3', retry: 30000 }))

      return true
    })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(5)
  })

  it('without done event', async () => {
    const stream = new ReadableStream<string>({
      async pull(controller) {
        controller.enqueue(': ping\n\n')
        controller.enqueue('event: message\ndata: {"order": 1}\nid: id-1\nretry: 10000\n\n')
        controller.enqueue('event: message\ndata: {"order": 2}\nid: id-2\n\n')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    const generator = toEventIterator(stream)
    expect(generator).toSatisfy(isAsyncIteratorObject)

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-1', retry: 10000 }))

      return true
    })

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 2 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-2', retry: undefined }))

      return true
    })

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(true)
      expect(value).toEqual(undefined)
      expect(getEventMeta(value)).toEqual(undefined)

      return true
    })

    await expect(stream.getReader().closed).resolves.toBe(undefined)

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(5)
  })

  it('with empty stream', async () => {
    const generator = toEventIterator(null)
    expect(generator).toSatisfy(isAsyncIteratorObject)
    expect(await generator.next()).toEqual({ done: true, value: undefined })
    expect(await generator.next()).toEqual({ done: true, value: undefined })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(1)
  })

  it('with error event', async () => {
    const stream = new ReadableStream<string>({
      async pull(controller) {
        controller.enqueue('event: message\ndata: {"order": 1}\nid: id-1\nretry: 10000\n\n')
        controller.enqueue('event: message\ndata: {"order": 2}\nid: id-2\n\n')
        controller.enqueue('event: error\ndata: {"order": 3}\nid: id-3\nretry: 30000\n\n')
        controller.enqueue(': ping\n\n')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    const generator = toEventIterator(stream)
    expect(generator).toSatisfy(isAsyncIteratorObject)

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-1', retry: 10000 }))

      return true
    })

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 2 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-2', retry: undefined }))

      return true
    })

    await expect(generator.next()).rejects.toSatisfy((error: any) => {
      expect(error).toBeInstanceOf(ErrorEvent)
      expect(error.data).toEqual({ order: 3 })
      expect(getEventMeta(error)).toEqual(expect.objectContaining({ id: 'id-3', retry: 30000 }))

      return true
    })

    await expect(stream.getReader().closed).resolves.toBe(undefined)

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(4)
  })

  it('when .return() before finish reading', async () => {
    const stream = new ReadableStream<string>({
      async pull(controller) {
        controller.enqueue('event: message\ndata: {"order": 1}\nid: id-1\nretry: 10000\n\n')
        await new Promise(resolve => setTimeout(resolve, 25))
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    const generator = toEventIterator(stream)
    expect(generator).toSatisfy(isAsyncIteratorObject)

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-1', retry: 10000 }))

      return true
    })

    // should throw if .return is called while waiting for .next()
    const nextPromise = expect(generator.next()).rejects.toBeInstanceOf(shared.AbortError)
    await new Promise(resolve => setTimeout(resolve, 0))

    await generator.return(undefined)
    await nextPromise

    await vi.waitFor(() => expect(stream.getReader().closed).resolves.toBe(undefined))

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
  })

  it('error while reading', async () => {
    const stream = new ReadableStream<string>({
      async pull(controller) {
        controller.enqueue('event: message\ndata: {"order": 1}\nid: id-1\nretry: 10000\n\n')
        await new Promise(resolve => setTimeout(resolve, 10))
        controller.error(new Error('Test error'))
      },
    }).pipeThrough(new TextEncoderStream())

    const generator = toEventIterator(stream)

    expect(await generator.next()).toSatisfy(({ done, value }) => {
      expect(done).toEqual(false)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(expect.objectContaining({ id: 'id-1', retry: 10000 }))

      return true
    })

    await expect(generator.next()).rejects.toThrow('Test error')

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
  })
})

describe('toEventStream', () => {
  it('with return', async () => {
    async function* gen() {
      yield withEventMeta({ order: 1 }, { id: 'id-1' })
      yield withEventMeta({ order: 2 }, { retry: 20000 })
      yield undefined
      return withEventMeta({ order: 4 }, { id: 'id-4', retry: 40000 })
    }

    const reader = toEventStream(gen())
      .pipeThrough(new TextDecoderStream())
      .getReader()

    expect((await reader.read())).toEqual({ done: false, value: ': \n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: message\nid: id-1\ndata: {"order":1}\n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: message\nretry: 20000\ndata: {"order":2}\n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: message\n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: done\nretry: 40000\nid: id-4\ndata: {"order":4}\n\n' })
    expect((await reader.read())).toEqual({ done: true, value: undefined })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(4)
  })

  it('without return', async () => {
    async function* gen() {
      yield withEventMeta({ order: 1 }, { id: 'id-1' })
      yield withEventMeta({ order: 2 }, { retry: 20000 })
      yield undefined
    }

    const reader = toEventStream(gen())
      .pipeThrough(new TextDecoderStream())
      .getReader()

    expect((await reader.read())).toEqual({ done: false, value: ': \n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: message\nid: id-1\ndata: {"order":1}\n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: message\nretry: 20000\ndata: {"order":2}\n\n' })
    expect((await reader.read())).toEqual({ done: false, value: 'event: message\n\n' })
    expect((await reader.read())).toEqual({ done: true, value: undefined })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(4)
  })

  it('with non-ErrorEvent error', async () => {
    async function* gen() {
      yield withEventMeta({ order: 1 }, { id: 'id-1' })
      yield withEventMeta({ order: 2 }, { retry: 20000 })
      yield undefined
      throw withEventMeta(new Error('order-4'), { id: 'id-4', retry: 40000 })
    }

    const reader = toEventStream(gen())
      .pipeThrough(new TextDecoderStream())
      .getReader()

    expect((await reader.read())).toEqual({ done: false, value: ': \n\n' })
    expect((await reader.read()).value).toEqual('event: message\nid: id-1\ndata: {"order":1}\n\n')
    expect((await reader.read()).value).toEqual('event: message\nretry: 20000\ndata: {"order":2}\n\n')
    expect((await reader.read()).value).toEqual('event: message\n\n')
    await expect(reader.read()).rejects.toThrow('order-4')

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(4)
  })

  it('with ErrorEvent error', async () => {
    async function* gen() {
      yield withEventMeta({ order: 1 }, { id: 'id-1' })
      yield withEventMeta({ order: 2 }, { retry: 20000 })
      yield undefined
      throw withEventMeta(new ErrorEvent({ data: { order: 4 } }), { id: 'id-4', retry: 40000 })
    }

    const reader = toEventStream(gen())
      .pipeThrough(new TextDecoderStream())
      .getReader()

    expect((await reader.read())).toEqual({ done: false, value: ': \n\n' })
    expect((await reader.read()).value).toEqual('event: message\nid: id-1\ndata: {"order":1}\n\n')
    expect((await reader.read()).value).toEqual('event: message\nretry: 20000\ndata: {"order":2}\n\n')
    expect((await reader.read()).value).toEqual('event: message\n\n')
    expect((await reader.read()).value).toEqual('event: error\nretry: 40000\nid: id-4\ndata: {"order":4}\n\n')
    expect((await reader.read()).done).toEqual(true)

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(4)
  })

  it('when canceled from client - return', async () => {
    let hasFinally = false

    async function* gen() {
      try {
        await new Promise(resolve => setTimeout(resolve, 10))
        yield 1
        await new Promise(resolve => setTimeout(resolve, 10))
        yield 2
      }
      finally {
        hasFinally = true
      }
    }

    const stream = toEventStream(gen())

    const reader = stream.getReader()
    await reader.read()
    await reader.read()
    await reader.cancel()

    await vi.waitFor(() => {
      expect(hasFinally).toBe(true)
    })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
  })

  it('when canceled from client - throw', async () => {
    let hasFinally = false

    async function* gen() {
      try {
        await new Promise(resolve => setTimeout(resolve, 10))
        yield 1
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('something')
      }
      finally {
        hasFinally = true
      }
    }

    const stream = toEventStream(gen())

    const reader = stream.getReader()
    await reader.read()
    await reader.read()
    await reader.cancel()

    await vi.waitFor(() => {
      expect(hasFinally).toBe(true)
    })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
  })

  it('throw while cleanup', async () => {
    let hasFinally = false

    async function* gen() {
      try {
        yield 1
        await new Promise(resolve => setTimeout(resolve, 10))
        yield 2
      }
      finally {
        hasFinally = true
        // eslint-disable-next-line no-unsafe-finally
        throw new Error('something')
      }
    }

    const stream = toEventStream(gen())

    const reader = stream.getReader()
    await reader.read()
    await reader.read()
    /**
     * This should throw, but because TextEncoderStream not rethrows cancel errors from the source stream,
     */
    await reader.cancel()

    await vi.waitFor(() => {
      expect(hasFinally).toBe(true)
    })

    expect(startSpanSpy).toHaveBeenCalledTimes(1)
    expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
  })

  describe('keep alive', () => {
    it('enabled', async () => {
      async function* gen() {
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 100))
          yield 'hello'
        }
      }

      const stream = toEventStream(gen(), {
        eventIteratorInitialCommentEnabled: false,
        eventIteratorKeepAliveEnabled: true,
        eventIteratorKeepAliveInterval: 40,
        eventIteratorKeepAliveComment: 'ping',
      })

      const reader = stream
        .pipeThrough(new TextDecoderStream())
        .getReader()

      const now = Date.now()
      await expect(reader.read()).resolves.toEqual({ done: false, value: ': ping\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(40)
      expect(Date.now() - now).toBeLessThan(50)

      await expect(reader.read()).resolves.toEqual({ done: false, value: ': ping\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(80)
      expect(Date.now() - now).toBeLessThan(100)

      await expect(reader.read()).resolves.toEqual({ done: false, value: 'event: message\ndata: "hello"\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(100)
      expect(Date.now() - now).toBeLessThan(130)

      await expect(reader.read()).resolves.toEqual({ done: false, value: ': ping\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(140)
      expect(Date.now() - now).toBeLessThan(180)

      await expect(reader.read()).resolves.toEqual({ done: false, value: ': ping\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(180)
      expect(Date.now() - now).toBeLessThan(230)

      await expect(reader.read()).resolves.toEqual({ done: false, value: 'event: message\ndata: "hello"\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(200)
      expect(Date.now() - now).toBeLessThan(260)

      expect(startSpanSpy).toHaveBeenCalledTimes(1)
      expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
    })

    it('disabled', async () => {
      async function* gen() {
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 100))
          yield 'hello'
        }
      }

      const stream = toEventStream(gen(), {
        eventIteratorInitialCommentEnabled: false,
        eventIteratorKeepAliveEnabled: false,
        eventIteratorKeepAliveInterval: 40,
        eventIteratorKeepAliveComment: 'ping',
      })

      const reader = stream
        .pipeThrough(new TextDecoderStream())
        .getReader()

      const now = Date.now()
      await expect(reader.read()).resolves.toEqual({ done: false, value: 'event: message\ndata: "hello"\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(100)
      expect(Date.now() - now).toBeLessThan(110)

      await expect(reader.read()).resolves.toEqual({ done: false, value: 'event: message\ndata: "hello"\n\n' })
      expect(Date.now() - now).toBeGreaterThanOrEqual(200)
      expect(Date.now() - now).toBeLessThan(220)

      expect(startSpanSpy).toHaveBeenCalledTimes(1)
      expect(runInSpanContextSpy).toHaveBeenCalledTimes(3)
    })
  })

  describe('initial comment', () => {
    it('enabled', async () => {
      async function* gen() {
        await shared.sleep(50)
        yield 'hello'
      }

      const stream = toEventStream(gen(), {
        eventIteratorInitialCommentEnabled: true,
        eventIteratorInitialComment: 'stream-started',
        eventIteratorKeepAliveEnabled: false,
      })

      const reader = stream
        .pipeThrough(new TextDecoderStream())
        .getReader()

      const start = Date.now()
      await expect(reader.read()).resolves.toEqual({ done: false, value: ': stream-started\n\n' })
      expect(Date.now() - start).toBeLessThan(10)
      await expect(reader.read()).resolves.toEqual({ done: false, value: 'event: message\ndata: "hello"\n\n' })
      expect(Date.now() - start).toBeGreaterThanOrEqual(50)
      expect(Date.now() - start).toBeLessThan(60)
    })

    it('disabled', async () => {
      async function* gen() {
        await shared.sleep(50)
        yield 'hello'
      }

      const stream = toEventStream(gen(), {
        eventIteratorInitialCommentEnabled: false,
        eventIteratorKeepAliveEnabled: false,
      })

      const reader = stream
        .pipeThrough(new TextDecoderStream())
        .getReader()

      const start = Date.now()
      await expect(reader.read()).resolves.toEqual({ done: false, value: 'event: message\ndata: "hello"\n\n' })
      expect(Date.now() - start).toBeGreaterThanOrEqual(50)
      expect(Date.now() - start).toBeLessThan(60)
    })
  })
})

it.each([
  [[1, 2, 3, 4, 5, 6]],
  [[{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }, { f: 6 }]],
])('toEventStream + toEventIterator: %#', async (...values) => {
  const iterator = toEventIterator(toEventStream((async function* () {
    for (const value of values) {
      await new Promise(resolve => setTimeout(resolve, 50))
      yield value
    }
  })(), { eventIteratorKeepAliveInterval: 10 }))

  for await (const value of iterator) {
    expect(value).toEqual(values.shift())
  }
})
