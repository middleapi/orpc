import type Stream from 'node:stream'
import type { NodeHttpResponse } from './types'
import { AbortError } from '@orpc/shared'
import { isNodeResponseStreamEnded } from './utils'

export function toAbortSignal(stream: Stream.Writable | NodeHttpResponse): AbortSignal {
  const controller = new AbortController()

  if (stream.errored) {
    controller.abort(stream.errored)
  }
  else if (isNodeResponseStreamEnded(stream)) {
    if (!stream.writableFinished || !stream.writableEnded) {
      controller.abort(new AbortError('Writable stream closed before it finished writing'))
    }
  }
  else {
    stream.once('error', error => controller.abort(error))

    stream.once('close', () => {
      if (!stream.writableFinished || !stream.writableEnded) {
        controller.abort(new AbortError('Writable stream closed before it finished writing'))
      }
    })
  }

  return controller.signal
}
