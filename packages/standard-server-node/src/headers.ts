import type { StandardHeaders } from '@orpc/standard-server'
import type { OutgoingHttpHeaders } from 'node:http'

export function toNodeHttpHeaders(headers: StandardHeaders): OutgoingHttpHeaders {
  const nodeHttpHeaders: OutgoingHttpHeaders = {}

  for (const key in headers) {
    const value = headers[key]
    // nodejs not allow header is undefined
    if (value !== undefined) {
      nodeHttpHeaders[key] = value
    }
  }

  return nodeHttpHeaders
}
