import type { StandardHeaders } from '@orpc/standard-server'
import type { OutgoingHttpHeaders } from 'node:http'

export function toNodeHttpHeaders(headers: StandardHeaders): OutgoingHttpHeaders {
  const nodeHttpHeaders: OutgoingHttpHeaders = {}

  for (const [key, value] of Object.entries(headers)) {
    // Node.js does not allow headers to be undefined
    if (value !== undefined) {
      nodeHttpHeaders[key] = value
    }
  }

  return nodeHttpHeaders
}
