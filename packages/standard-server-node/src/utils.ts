import type Stream from 'node:stream'
import type { NodeHttpResponse } from './types'

export function isNodeResponseStreamEnded(res: Stream.Writable | NodeHttpResponse): boolean {
  const stream = 'stream' in res ? res.stream : res
  return stream.closed || stream.destroyed || stream.writableFinished
}
