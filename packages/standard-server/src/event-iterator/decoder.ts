import type { EventMessage } from './types'
import { EventDecoderError } from './errors'

// A line ending is CR, LF or CRLF.
const LINE_ENDING_REGEX = /\r\n|\r(?!\n)|\n/
const MESSAGE_DELIMITER_REGEX = /(?:\r\n|\r(?!\n)|\n){2}/
const MESSAGE_DELIMITER_GLOBAL_REGEX = /(?:\r\n|\r(?!\n)|\n){2}/g

// A delimiter is at most 4 characters ('\r\n\r\n'), so one crossing a chunk
// boundary must start within the last 3 characters of what came before.
const MAX_DELIMITER_OVERLAP = 3

const CR = 0x0D
const LF = 0x0A
const SPACE = 0x20

export function decodeEventMessage(encoded: string): EventMessage {
  const message: EventMessage = {
    data: undefined,
    event: undefined,
    id: undefined,
    retry: undefined,
    comments: [],
  }

  for (const line of encoded.split(LINE_ENDING_REGEX)) {
    if (line === '') {
      continue
    }

    const index = line.indexOf(':')

    // The value may be prefixed by a single space
    // https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
    const value = index === -1
      ? ''
      : line.slice(line.charCodeAt(index + 1) === SPACE ? index + 2 : index + 1)

    if (index === 0) { // comment starting with ':'
      message.comments.push(value)
      continue
    }

    switch (index === -1 ? line : line.slice(0, index)) {
      case 'data':
        // data can be sent in multiple lines if containing newlines
        // https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
        message.data = message.data === undefined
          ? value
          : `${message.data}\n${value}`
        break

      case 'event':
        message.event = value
        break

      case 'id':
        message.id = value
        break

      case 'retry': {
        const maybeInteger = Number.parseInt(value, 10)

        // The round-trip check already rejects NaN, signs, padding and floats.
        if (maybeInteger >= 0 && maybeInteger.toString() === value) {
          message.retry = maybeInteger
        }
        break
      }
    }
  }

  return message
}

export interface EventDecoderOptions {
  onEvent?: (event: EventMessage) => void
}

export class EventDecoder {
  private pending: string[] = []
  // Last up-to-3 characters of the pending buffer, prefixed to the next chunk
  // so a delimiter straddling the boundary is still found.
  private tail: string = ''
  // Set when a chunk-ending '\r' was already consumed as a line ending, so a
  // leading '\n' in the next chunk is the second half of that CRLF pair.
  private discardLeadingLF: boolean = false

  constructor(private options: EventDecoderOptions = {}) {
  }

  feed(chunk: string): void {
    // empty chunk has no meaningful content to process
    if (chunk === '') {
      return
    }

    if (this.discardLeadingLF) {
      this.discardLeadingLF = false

      if (chunk.charCodeAt(0) === LF) {
        chunk = chunk.slice(1)

        // empty chunk has no meaningful content to process
        if (chunk === '') {
          return
        }
      }
    }

    const scan = this.tail + chunk

    if (!MESSAGE_DELIMITER_REGEX.test(scan)) {
      this.pending.push(chunk)
      this.tail = scan.slice(-MAX_DELIMITER_OVERLAP)
      return
    }

    this.pending.push(chunk)
    const buffered = this.pending.length === 1 ? chunk : this.pending.join('')
    const offset = buffered.length - scan.length

    const parts: string[] = []
    let start = 0

    for (const match of scan.matchAll(MESSAGE_DELIMITER_GLOBAL_REGEX)) {
      parts.push(buffered.slice(start, offset + match.index))
      start = offset + match.index + match[0].length
    }

    const incomplete = buffered.slice(start)
    this.pending.length = 0
    this.tail = incomplete.slice(-MAX_DELIMITER_OVERLAP)

    if (incomplete === '') {
      this.discardLeadingLF = chunk.charCodeAt(chunk.length - 1) === CR
    }
    else {
      this.pending.push(incomplete)
    }

    for (const encoded of parts) {
      const message = decodeEventMessage(encoded)

      if (this.options.onEvent) {
        this.options.onEvent(message)
      }
    }
  }

  end(): void {
    if (this.pending.length !== 0) {
      throw new EventDecoderError('Event Iterator ended before complete')
    }
  }
}

export class EventDecoderStream extends TransformStream<string, EventMessage> {
  constructor() {
    let decoder!: EventDecoder

    super({
      start(controller) {
        decoder = new EventDecoder({
          onEvent: (event) => {
            controller.enqueue(event)
          },
        })
      },
      transform(chunk) {
        decoder.feed(chunk)
      },
      flush() {
        decoder.end()
      },
    })
  }
}
