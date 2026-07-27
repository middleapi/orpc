import type Stream from 'node:stream'
import type { NodeHttpResponse } from './types'
import { AbortError } from '@orpc/shared'
import { isNodeResponseStreamEnded } from './utils'

export function toAbortSignal(stream: Stream.Writable | NodeHttpResponse): AbortSignal {
  const controller = new AbortController()

  // Http2ServerResponse delegates writableFinished to its underlying Http2Stream,
  // which force-ends its writable side even on abnormal close, so writableEnded
  // is required to know whether the response actually completed
  const isFinishedWriting = () => stream.writableEnded && stream.writableFinished

  if (stream.errored) {
    controller.abort(stream.errored)
  }
  else if (isNodeResponseStreamEnded(stream)) {
    if (!isFinishedWriting()) {
      controller.abort(new AbortError('Writable stream closed before it finished writing'))
    }
  }
  else {
    stream.once('error', error => controller.abort(error))

    stream.once('close', () => {
      if (!isFinishedWriting()) {
        controller.abort(new AbortError('Writable stream closed before it finished writing'))
      }
    })
  }

  return controller.signal
}
