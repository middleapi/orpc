import type { StandardResponse } from '@orpc/standard-server'
import type Stream from 'node:stream'
import type { ToLambdaBodyOptions } from './body'
import { toLambdaBody } from './body'
import { toLambdaHeaders } from './headers'

export interface SendStandardResponseOptions extends ToLambdaBodyOptions {}

export function sendStandardResponse(
  responseStream: Stream.Writable,
  standardResponse: StandardResponse,
  options: SendStandardResponseOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const [body, standardHeaders] = toLambdaBody(standardResponse.body, standardResponse.headers, options)

    if (responseStream.closed || responseStream.destroyed) {
      if (typeof body === 'object' && !body.closed) {
        body.destroy(responseStream.errored ?? undefined)
      }

      if (responseStream.errored) {
        reject(responseStream.errored)
      }
      else {
        resolve()
      }

      return
    }

    responseStream.once('error', reject)
    responseStream.once('close', resolve)
    const [headers, setCookies] = toLambdaHeaders(standardHeaders)

    // awslambda is global aws lambda global object
    ;(globalThis as any).awslambda.HttpResponseStream.from(responseStream, {
      statusCode: standardResponse.status,
      headers,
      cookies: setCookies,
    })

    if (body === undefined) {
      responseStream.end()
    }
    else if (typeof body === 'string') {
      responseStream.write(body)
      responseStream.end() // awslambda will throw if we call .end with args
    }
    else {
      responseStream.once('close', () => {
        if (!body.closed) {
          body.destroy(responseStream.errored ?? undefined)
        }
      })

      body.once('error', error => responseStream.destroy(error))

      body.pipe(responseStream)
    }
  })
}
