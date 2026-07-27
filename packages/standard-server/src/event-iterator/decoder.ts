import type { EventMessage } from './types'
import { EventDecoderError } from './errors'

export function decodeEventMessage(encoded: string): EventMessage {
  const lines = encoded.replace(/\n+$/, '').split(/\n/)

  const message: EventMessage = {
    data: undefined,
    event: undefined,
    id: undefined,
    retry: undefined,
    comments: [],
  }

  for (const line of lines) {
    const index = line.indexOf(':')

    const key = index === -1 ? line : line.slice(0, index)
    const value = index === -1 ? '' : line.slice(index + 1).replace(/^\s/, '')

    if (index === 0) {
      message.comments.push(value)
    }

    else if (key === 'data') {
      message.data ??= ''
      message.data += `${value}\n`
    }

    else if (key === 'event') {
      message.event = value
    }

    else if (key === 'id') {
      message.id = value
    }

    else if (key === 'retry') {
      const maybeInteger = Number.parseInt(value)

      if (Number.isInteger(maybeInteger) && maybeInteger >= 0 && maybeInteger.toString() === value) {
        message.retry = maybeInteger
      }
    }
  }

  message.data = message.data?.replace(/\n$/, '')

  return message
}

export interface EventDecoderOptions {
  onEvent?: (event: EventMessage) => void
}

/**
 * Buffers incoming SSE chunks and emits a decoded {@link EventMessage} for
 * each complete `\n\n`-terminated event.
 *
 * Chunks are kept in an array rather than concatenated into one string.
 * `'\n\n'` is 2 characters, so it can only appear (a) inside one incoming
 * chunk, or (b) split exactly across the boundary between the previous
 * chunk's last character and this chunk's first — never spanning 3+ chunks.
 * So each `feed` only needs to check the new chunk (bounded by that chunk's
 * own size) plus one carried-over character, not the buffered backlog.
 * `chunks.join('')` — the only operation whose cost depends on the backlog
 * size — runs once per completed event rather than once per chunk.
 *
 * The previous implementation kept a single growing string (`incomplete +=
 * chunk`) and called `incomplete.lastIndexOf('\n\n')` on every `feed`. That
 * search is O(n) in the buffered length so far, and for one large event
 * delivered across many small chunks — no `'\n\n'` appears until the event
 * completes — every intermediate call pays that O(n) cost just to confirm
 * absence, making the whole decode O(n^2) in that event's size. A `fromIndex`
 * does not fix it either: a string built by repeated `+=` is represented as a
 * rope (V8's ConsString), and any read forces reflattening the whole rope
 * regardless of where the search starts.
 */
export class EventDecoder {
  private chunks: string[] = []
  private chunksLength = 0
  private lastChar = ''

  constructor(private options: EventDecoderOptions = {}) {
  }

  feed(chunk: string): void {
    if (chunk.length === 0) {
      return
    }

    const boundaryDelimiter = this.lastChar === '\n' && chunk.charCodeAt(0) === 10
    const hasDelimiterInChunk = chunk.includes('\n\n')

    this.chunks.push(chunk)
    this.chunksLength += chunk.length
    this.lastChar = chunk.slice(-1)

    if (!boundaryDelimiter && !hasDelimiterInChunk) {
      return
    }

    const incomplete = this.chunks.join('')
    const lastCompleteIndex = incomplete.lastIndexOf('\n\n')

    if (lastCompleteIndex === -1) {
      this.chunks = [incomplete]
      return
    }

    const completes = incomplete.slice(0, lastCompleteIndex).split(/\n\n/)
    const remainder = incomplete.slice(lastCompleteIndex + 2)

    this.chunks = remainder.length > 0 ? [remainder] : []
    this.chunksLength = remainder.length
    this.lastChar = remainder.slice(-1)

    for (const encoded of completes) {
      const message = decodeEventMessage(`${encoded}\n\n`)

      if (this.options.onEvent) {
        this.options.onEvent(message)
      }
    }
  }

  end(): void {
    if (this.chunksLength > 0) {
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
