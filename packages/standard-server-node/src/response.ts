import type { StandardHeaders, StandardResponse } from '@orpc/standard-server'
import type { ToNodeHttpBodyOptions } from './body'
import type { NodeHttpResponse } from './types'
import { toNodeHttpBody } from './body'
import { toNodeHttpHeaders } from './headers'
import { isNodeResponseStreamEnded } from './utils'

export interface SendStandardResponseOptions extends ToNodeHttpBodyOptions {}

export function sendStandardResponse(
  res: NodeHttpResponse,
  standardResponse: StandardResponse,
  options: SendStandardResponseOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const resHeaders: StandardHeaders = { ...standardResponse.headers }

    const resBody = toNodeHttpBody(standardResponse.body, resHeaders, options)

    if (isNodeResponseStreamEnded(res)) {
      if (typeof resBody === 'object' && !resBody.closed) {
        resBody.destroy()
      }

      if (res.errored) {
        reject(res.errored)
      }
      else {
        resolve()
      }

      return
    }

    res.once('error', reject)
    res.once('close', resolve)

    // Node.js throws an error when a header is undefined, so remember to use toNodeHttpHeaders
    // to filter out undefined headers
    res.writeHead(standardResponse.status, toNodeHttpHeaders(resHeaders))

    if (resBody === undefined) {
      res.end()
    }
    else if (typeof resBody === 'string') {
      res.end(resBody)
    }
    else {
      res.once('close', () => {
        if (!resBody.closed) {
          resBody.destroy(res.errored ?? undefined)
        }
      })

      resBody.once('error', error => res.destroy(error))

      resBody.pipe(res)
    }
  })
}
