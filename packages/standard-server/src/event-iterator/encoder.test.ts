import type { EventMessage } from './types'
import { decodeEventMessage } from './decoder'
import { encodeEventComments, encodeEventData, encodeEventMessage } from './encoder'

describe('encodeEventData', () => {
  it('encodes undefined as no output', () => {
    expect(encodeEventData(undefined)).toBe('')
  })

  it('encodes single-line data', () => {
    expect(encodeEventData('hello')).toBe('data: hello\n')
    expect(encodeEventData('')).toBe('data: \n')
  })

  it('splits multi-line data into one data field per line', () => {
    expect(encodeEventData('hello\nworld')).toBe('data: hello\ndata: world\n')
    expect(encodeEventData('hello\rworld')).toBe('data: hello\ndata: world\n')
    expect(encodeEventData('hello\r\nworld')).toBe('data: hello\ndata: world\n')
  })

  it('preserves trailing line endings as an empty data field', () => {
    expect(encodeEventData('hello\nworld\n')).toBe('data: hello\ndata: world\ndata: \n')
    expect(encodeEventData('hello\rworld\r')).toBe('data: hello\ndata: world\ndata: \n')
    expect(encodeEventData('hello\r\nworld\r\n')).toBe('data: hello\ndata: world\ndata: \n')
  })
})

describe('encodeEventComments', () => {
  it('encodes undefined or empty comments as no output', () => {
    expect(encodeEventComments(undefined)).toBe('')
    expect(encodeEventComments([])).toBe('')
  })

  it('encodes each comment on its own line', () => {
    expect(encodeEventComments(['hello'])).toBe(': hello\n')
    expect(encodeEventComments(['hello', 'world'])).toBe(': hello\n: world\n')
  })

  it('rejects comments containing line breaks', () => {
    expect(() => encodeEventComments(['hi\n']))
      .toThrowError('Event\'s comment must not contain a carriage return or newline character')
  })
})

describe('encodeEventMessage', () => {
  it('on success', () => {
    expect(encodeEventMessage({})).toEqual('\n')
    expect(encodeEventMessage({ event: 'message', data: 'hello\nworld' })).toEqual('event: message\ndata: hello\ndata: world\n\n')
    expect(encodeEventMessage({ event: 'message', id: '123', retry: 10000 }))
      .toEqual('event: message\nretry: 10000\nid: 123\n\n')
    expect(encodeEventMessage({ event: 'message', id: '123', retry: 10000, comments: ['hello', 'world'] }))
      .toEqual(': hello\n: world\nevent: message\nretry: 10000\nid: 123\n\n')
  })

  it('round-trips through decodeEventMessage', () => {
    const messages: Partial<EventMessage>[] = [
      {},
      { data: 'hello' },
      { data: 'hello\nworld\n' },
      { event: 'message', data: 'hello', id: '123', retry: 10000, comments: ['hi'] },
    ]

    for (const message of messages) {
      expect(decodeEventMessage(encodeEventMessage(message))).toEqual({ comments: [], ...message })
    }
  })

  it('invalid event', () => {
    for (const lineBreak of ['\n', '\r', '\r\n']) {
      expect(() => encodeEventMessage({ event: `hi${lineBreak}` }))
        .toThrowError('Event\'s event must not contain a carriage return or newline character')
    }
  })

  it('invalid id', () => {
    for (const lineBreak of ['\n', '\r', '\r\n']) {
      expect(() => encodeEventMessage({ event: 'message', id: `hi${lineBreak}` }))
        .toThrowError('Event\'s id must not contain a carriage return or newline character')
    }
  })

  it('invalid retry', () => {
    expect(() => encodeEventMessage({ event: 'message', retry: Number.NaN }))
      .toThrowError('Event\'s retry must be a integer and >= 0')

    expect(() => encodeEventMessage({ event: 'message', retry: -1 }))
      .toThrowError('Event\'s retry must be a integer and >= 0')

    expect(() => encodeEventMessage({ event: 'message', retry: 1.5 }))
      .toThrowError('Event\'s retry must be a integer and >= 0')
  })

  it('invalid comment', () => {
    for (const lineBreak of ['\n', '\r', '\r\n']) {
      expect(() => encodeEventMessage({ event: 'message', comments: [`hi${lineBreak}`] }))
        .toThrowError('Event\'s comment must not contain a carriage return or newline character')
    }
  })
})
