import type { EventMessage } from './types'
import { decodeEventMessage, EventDecoder, EventDecoderStream } from './decoder'

function feedAll(chunks: string[]): EventMessage[] {
  const events: EventMessage[] = []
  const decoder = new EventDecoder({ onEvent: event => events.push(event) })

  for (const chunk of chunks) {
    decoder.feed(chunk)
  }

  decoder.end()

  return events
}

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

    // Per spec, only a single U+0020 SPACE is stripped — not tabs.
    expect(decodeEventMessage('data:\thello\n\n')).toEqual({
      data: '\thello',
      comments: [],
    })
  })

  it('supports LF, CR, and CRLF line endings', () => {
    expect(decodeEventMessage('event: message\rdata: hello\r\ndata: world\rid: 123\r\nretry: 10000\r\r\n')).toEqual({
      event: 'message',
      data: 'hello\nworld',
      id: '123',
      retry: 10000,
      comments: [],
    })
  })

  it('treats lines without a colon as fields with empty values', () => {
    expect(decodeEventMessage('data\n\n')).toEqual({ data: '', comments: [] })
    expect(decodeEventMessage('data:\n\n')).toEqual({ data: '', comments: [] })
    expect(decodeEventMessage('data: a\ndata:\ndata: b\n\n')).toEqual({ data: 'a\n\nb', comments: [] })
    expect(decodeEventMessage('event\ndata: x\n\n')).toEqual({ event: '', data: 'x', comments: [] })
  })

  it('unknown keys', () => {
    expect(decodeEventMessage('foo: bar\n\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('Data: x\nEVENT: y\n\n')).toEqual({
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
    expect(decodeEventMessage('retry: 0\n\n')).toEqual({
      retry: 0,
      comments: [],
    })

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

    expect(decodeEventMessage('retry: 010\n\n')).toEqual({
      comments: [],
    })

    expect(decodeEventMessage('retry: +10\n\n')).toEqual({
      comments: [],
    })

    // extra space survives the single-space strip
    expect(decodeEventMessage('retry:  10\n\n')).toEqual({
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

  it('ignores empty chunks', () => {
    expect(feedAll(['', 'data: hello', '', '\n\n', ''])).toEqual([
      { data: 'hello', comments: [] },
    ])
  })

  it('emits the same events regardless of chunk size', () => {
    const stream = 'event: a\r\ndata: 1\r\n\r\n: comment\ndata: 2\ndata: 3\n\nid: 9\rretry: 50\rdata: 4\r\revent: done\ndata: bye\n\n'

    const expected = feedAll([stream])
    expect(expected).toHaveLength(4)

    for (const size of [1, 2, 3, 4, 5, 7, 11]) {
      const chunks: string[] = []
      for (let i = 0; i < stream.length; i += size) {
        chunks.push(stream.slice(i, i + size))
      }

      expect(feedAll(chunks), `chunk size ${size}`).toEqual(expected)
    }
  })

  it('decodes a large message fed in many small chunks', () => {
    const value = 'x'.repeat(64 * 1024)
    const stream = `event: big\ndata: ${value}\ndata: ${value}\n\n`

    const chunks: string[] = []
    for (let i = 0; i < stream.length; i += 251) {
      chunks.push(stream.slice(i, i + 251))
    }

    expect(feedAll(chunks)).toEqual([
      { event: 'big', data: `${value}\n${value}`, comments: [] },
    ])
  })

  it('handles every delimiter split at every position', () => {
    for (const delimiter of ['\n\n', '\r\r', '\n\r', '\n\r\n', '\r\n\n', '\r\n\r\n']) {
      const stream = `data: first${delimiter}data: second${delimiter}`

      for (let split = 1; split < stream.length; split++) {
        const events = feedAll([stream.slice(0, split), stream.slice(split)])

        expect(events, `delimiter ${JSON.stringify(delimiter)} split at ${split}`).toEqual([
          { data: 'first', comments: [] },
          { data: 'second', comments: [] },
        ])
      }
    }
  })

  it('handles CR & CRLF delimiters', () => {
    const events = feedAll([
      'event: message\rdata: hello\r\ndata: world\r',
      '\r\nevent: done\r',
      'data: bye\r\n\r',
    ])

    expect(events).toEqual([
      { event: 'message', data: 'hello\nworld', comments: [] },
      { event: 'done', data: 'bye', comments: [] },
    ])
  })

  it('handles CRLF line endings split across chunks', () => {
    const events = feedAll([
      'event: message\r',
      '\ndata: hello\r',
      '\ndata: world\r',
      '\n\r',
      '\n',
      'event: done\rdata: bye\r\r',
    ])

    expect(events).toEqual([
      { event: 'message', data: 'hello\nworld', comments: [] },
      { event: 'done', data: 'bye', comments: [] },
    ])
  })

  it('keeps the CRLF discard window open across empty chunks', () => {
    const events = feedAll([
      'data: first\n\r',
      '',
      '\n\ndata: second\n\n',
    ])

    expect(events).toEqual([
      { data: 'first', comments: [] },
      { data: 'second', comments: [] },
    ])
  })

  // Per spec, the '\n' completes the buffered '\r' into a single CRLF line
  // ending, so the following '\n' is a blank line terminating the message.
  it('handles a CRLF+LF delimiter split between the CR and LF', () => {
    const events = feedAll([
      'data: first\r',
      '\n\ndata: second\n\n',
    ])

    expect(events).toEqual([
      { data: 'first', comments: [] },
      { data: 'second', comments: [] },
    ])
  })

  it('does not throw when nothing was fed or the stream completed cleanly', () => {
    const decoder = new EventDecoder()
    expect(() => decoder.end()).not.toThrow()

    decoder.feed('data: hello\n\n')
    expect(() => decoder.end()).not.toThrow()
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
