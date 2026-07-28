import type { EventMessage } from './types'
import { EventEncoderError } from './errors'

const LINE_ENDING_REGEX = /\r\n|[\n\r]/
const LINE_ENDING_GLOBAL_REGEX = /\r\n|[\n\r]/g

function containsLineBreak(value: string): boolean {
  return LINE_ENDING_REGEX.test(value)
}

export function assertEventId(id: string): void {
  if (containsLineBreak(id)) {
    throw new EventEncoderError('Event\'s id must not contain a carriage return or newline character')
  }
}

export function assertEventName(event: string): void {
  if (containsLineBreak(event)) {
    throw new EventEncoderError('Event\'s event must not contain a carriage return or newline character')
  }
}

export function assertEventRetry(retry: number): void {
  if (!Number.isInteger(retry) || retry < 0) {
    throw new EventEncoderError('Event\'s retry must be a integer and >= 0')
  }
}

export function assertEventComment(comment: string): void {
  if (containsLineBreak(comment)) {
    throw new EventEncoderError('Event\'s comment must not contain a carriage return or newline character')
  }
}

export function encodeEventData(data: string | undefined): string {
  if (data === undefined) {
    return ''
  }

  return `data: ${data.replace(LINE_ENDING_GLOBAL_REGEX, '\ndata: ')}\n`
}

export function encodeEventComments(comments: string[] | undefined): string {
  let output = ''

  for (const comment of comments ?? []) {
    assertEventComment(comment)

    output += `: ${comment}\n`
  }

  return output
}

export function encodeEventMessage(message: Partial<EventMessage>): string {
  let output = ''

  output += encodeEventComments(message.comments)

  if (message.event !== undefined) {
    assertEventName(message.event)

    output += `event: ${message.event}\n`
  }

  if (message.retry !== undefined) {
    assertEventRetry(message.retry)

    output += `retry: ${message.retry}\n`
  }

  if (message.id !== undefined) {
    assertEventId(message.id)

    output += `id: ${message.id}\n`
  }

  output += encodeEventData(message.data)
  output += '\n'

  return output
}
