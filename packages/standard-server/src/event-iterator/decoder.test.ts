import type { EventMessage } from './types'
import { decodeEventMessage, EventDecoder, EventDecoderStream } from './decoder'

describe('decodeEventMessage', () => {
  it('on success', () => {
    expect(decodeEventMessage('\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('event: message\n\n')).toEqual({
      event: 'message',
      comments: [],
    })

    expect(decodeEventMessage('event: message\ndata: hello\ndata: world\n\n')).toEqual({
      event: 'message',
      data: 'hello\nworld',
      comments: [],
    })

    expect(decodeEventMessage(': hi\n: hello\nevent: message\ndata: hello\ndata: world\n\n')).toEqual({
      event: 'message',
      data: 'hello\nworld',
      comments: ['hi', 'hello'],
    })

    expect(decodeEventMessage('event: message\ndata: hello\ndata: world\nid: 123\nretry: 10000\n\n')).toEqual({
      event: 'message',
      data: 'hello\nworld',
      id: '123',
      retry: 10000,
      comments: [],
    })
  })

  it('on success - spaces', () => {
    expect(decodeEventMessage(':hi\nevent:message\ndata:hello\ndata:world\n\n')).toEqual({
      event: 'message',
      data: 'hello\nworld',
      comments: ['hi'],
    })

    expect(decodeEventMessage(':  hi\nevent:  message\ndata:  hello\ndata:  world\n\n')).toEqual({
      event: ' message',
      data: ' hello\n world',
      comments: [' hi'],
    })
  })

  it('unknown keys', () => {
    expect(decodeEventMessage('foo: bar\n\n')).toEqual({
      comments: [],
    })
  })

  it('duplicate keys', () => {
    expect(decodeEventMessage('id: 123\nid: 456\n\n')).toEqual({
      id: '456',
      comments: [],
    })
  })

  it('invalid retry', () => {
    expect(decodeEventMessage('retry: hello\n\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('retry: 1.5\n\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('retry: -1\n\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('retry: 1abc\n\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('retry: Infinity\n\n')).toEqual({
      comments: [],
    })
  })
})

describe('eventDecoder', () => {
  it('on success with mixed chunks', () => {
    const onEvent = vi.fn()

    const decoder = new EventDecoder({ onEvent })

    decoder.feed('event: message\n')
    decoder.feed('data: hello1\n')
    decoder.feed('data: world\n\n')

    decoder.feed('event: message\ndata: hello2\ndata: world\n\n')
    // NOTE: a chunk contain 1,5 events is important test, carefully when modify
    decoder.feed('event: message\ndata: hello3\ndata: world\n\nevent: message\ndata: hello4\n')
    decoder.feed('data: world\nid: 123\nretry: 10000\n\nevent: done\ndata: hello5\ndata: world\nid: 123\nretry: 10000\n')
    decoder.feed('\n')

    decoder.end()

    expect(onEvent).toHaveBeenCalledTimes(5)
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      data: 'hello1\nworld',
      event: 'message',
      id: undefined,
      retry: undefined,
      comments: [],
    })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      data: 'hello2\nworld',
      event: 'message',
      id: undefined,
      retry: undefined,
      comments: [],
    })
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      data: 'hello3\nworld',
      event: 'message',
      id: undefined,
      retry: undefined,
      comments: [],
    })
    expect(onEvent).toHaveBeenNthCalledWith(4, {
      data: 'hello4\nworld',
      event: 'message',
      id: '123',
      retry: 10000,
      comments: [],
    })
    expect(onEvent).toHaveBeenNthCalledWith(5, {
      data: 'hello5\nworld',
      event: 'done',
      id: '123',
      retry: 10000,
      comments: [],
    })
  })

  it('on incomplete message', () => {
    const onEvent = vi.fn()

    const decoder = new EventDecoder({ onEvent })

    decoder.feed('event: message\ndata: hello1\ndata: world\n\n')
    decoder.feed('event: message\ndata: hello2\ndata: world\nid: 123\nretry: 10000\n')

    expect(() => decoder.end()).toThrowError('Event Iterator ended before complete')

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      data: 'hello1\nworld',
      event: 'message',
      id: undefined,
      retry: undefined,
      comments: [],
    })
  })

  it('decodes identically no matter how a message is split across feed calls', () => {
    const full = 'id: 1\nevent: a\ndata: {"x":1}\n\nid: 2\nevent: b\ndata: {"x":2}\n\nid: 3\nevent: c\ndata: {"x":3}\n\n'

    for (const chunkSize of [1, 2, 3, 7, 1000]) {
      const onEvent = vi.fn()
      const decoder = new EventDecoder({ onEvent })

      for (let i = 0; i < full.length; i += chunkSize) {
        decoder.feed(full.slice(i, i + chunkSize))
      }
      decoder.end()

      expect(onEvent.mock.calls.map(([event]) => event.id)).toEqual(['1', '2', '3'])
    }
  })

  it('decodes a large single event fed in many small chunks, and stays fast doing it', () => {
    const onEvent = vi.fn()
    const decoder = new EventDecoder({ onEvent })

    // Regression test for a quadratic-time bug: the previous implementation
    // buffered chunks into one growing string and re-scanned the whole thing
    // on every feed(), which made decoding a single large event O(n^2) in its
    // size. A 6MB event fed in 64-byte chunks took minutes under that
    // implementation; this must complete well within the test timeout.
    const chunk = 'x'.repeat(64)
    const chunkCount = Math.floor((6 * 1024 * 1024) / chunk.length)

    for (let i = 0; i < chunkCount; i++) {
      decoder.feed(chunk)
    }
    decoder.feed('\n\n')
    decoder.end()

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0].comments).toEqual([])
  }, 2000)
})

describe('eventDecoderStream', () => {
  it('on success', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('event: message\ndata: hello1\ndata: world\n\n')
        controller.enqueue('event: message\ndata: hello2\ndata: world\nid: 123\nretry: 10000\n\n')
        controller.enqueue('event: message\ndata: hello3\ndata: world\nid: 123\nretry: 10000\n\n')
        controller.enqueue('event: done\n')
        controller.enqueue('data: hello4\n')
        controller.enqueue('data: world\n\n')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    const response = new Response(stream)

    const eventStream = response.body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventDecoderStream())

    const messages: EventMessage[] = []

    for await (const message of eventStream) {
      messages.push(message)
    }

    expect(messages).toEqual([
      {
        data: 'hello1\nworld',
        event: 'message',
        id: undefined,
        retry: undefined,
        comments: [],
      },
      {
        data: 'hello2\nworld',
        event: 'message',
        id: '123',
        retry: 10000,
        comments: [],
      },
      {
        data: 'hello3\nworld',
        event: 'message',
        id: '123',
        retry: 10000,
        comments: [],
      },
      {
        data: 'hello4\nworld',
        event: 'done',
        id: undefined,
        retry: undefined,
        comments: [],
      },
    ])
  })

  it('on incomplete message', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('event: message\ndata: hello1\ndata: world\n\n')
        controller.enqueue('event: message\ndata: hello2\ndata: world\nid: 123\nretry: 10000\n')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    const response = new Response(stream)

    const eventStream = response.body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventDecoderStream())

    const messages: EventMessage[] = []

    await expect(async () => {
      for await (const message of eventStream) {
        messages.push(message)
      }
    }).rejects.toThrowError('Event Iterator ended before complete')

    expect(messages).toEqual([
      {
        data: 'hello1\nworld',
        event: 'message',
        id: undefined,
        retry: undefined,
        comments: [],
      },
    ])
  })
})
