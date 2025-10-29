import type { StandardBody, StandardHeaders, StandardResponse } from '@orpc/standard-server'
import type { ToNodeHttpBodyOptions } from './body'
import type { NodeHttpResponse } from './types'
import { Readable } from 'node:stream'
import { toNodeHttpBody, toResponseBody } from './body'

export interface SendStandardResponseOptions extends ToNodeHttpBodyOptions {}

export function sendStandardResponse(
  res: NodeHttpResponse,
  standardResponse: StandardResponse,
  options: SendStandardResponseOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    res.once('error', reject)
    res.once('close', resolve)

    const resHeaders: StandardHeaders = { ...standardResponse.headers }

    const resBody = toNodeHttpBody(standardResponse.body, resHeaders, options)

    res.writeHead(standardResponse.status, resHeaders)

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
export function setStandardResponse(
  res: NodeHttpResponse,
  standardResponse: StandardResponse,
  options: SendStandardResponseOptions = {},
): Promise<void | StandardBody | undefined> {
  return new Promise((resolve, reject) => {
    res.once('error', reject)
    res.once('close', resolve)

    const resHeaders: StandardHeaders = { ...standardResponse.headers }

    const resBody = toResponseBody(standardResponse.body, resHeaders, options)

    res.statusCode = standardResponse.status
    for (const [key, value] of Object.entries(resHeaders)) {
      if (value !== undefined) {
        res.setHeader(key, value)
      }
    }

    if (resBody === undefined) {
      return resolve(undefined)
    }
    else if (resBody instanceof Readable) {
      res.once('close', () => {
        if (!resBody.closed) {
          resBody.destroy(res.errored ?? undefined)
        }
      })

      resBody.once('error', error => res.destroy(error))

      resBody.pipe(res)
    }
    else {
      return resolve(resBody)
    }
  })
}
