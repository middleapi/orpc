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

export class EventDecoder {
  private incomplete: string = ''

  constructor(private options: EventDecoderOptions = {}) {
  }

  feed(chunk: string): void {
    this.incomplete += chunk

    const lastCompleteIndex = this.incomplete.lastIndexOf('\n\n')

    if (lastCompleteIndex === -1) {
      return
    }

    const completes = this.incomplete.slice(0, lastCompleteIndex).split(/\n\n/)
    this.incomplete = this.incomplete.slice(lastCompleteIndex + 2)

    for (const encoded of completes) {
      const message = decodeEventMessage(`${encoded}\n\n`)

      if (this.options.onEvent) {
        this.options.onEvent(message)
      }
    }
  }

  end(): void {
    if (this.incomplete) {
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
