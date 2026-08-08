import type { HttpAdapterHost } from '@nestjs/core'
import type { StandardResponse } from '@standardserver/core'
import type { ToEventStreamOptions } from '@standardserver/node'
import { Readable } from 'node:stream'
import { StreamableFile } from '@nestjs/common'
import { isAsyncIteratorObject, stringifyJSON } from '@orpc/shared'
import { flattenStandardHeader, generateContentDisposition } from '@standardserver/core'
import { toEventStream } from '@standardserver/node'

export interface ToNestResponseOptions {
  eventStream?: undefined | ToEventStreamOptions
}

export function sendStandardResponseToNest(
  httpAdapter: HttpAdapterHost['httpAdapter'],
  res: any,
  standardResponse: StandardResponse,
  options?: ToNestResponseOptions,
): any {
  httpAdapter.status(res, standardResponse.status)

  for (const key in standardResponse.headers) {
    const value = standardResponse.headers[key]
    if (typeof value === 'string') {
      httpAdapter.setHeader(res, key, value)
    }
    else {
      value?.forEach((val, index) => {
        if (index === 0) {
          httpAdapter.setHeader(res, key, val)
        }
        else {
          httpAdapter.appendHeader(res, key, val)
        }
      })
    }
  }

  const body = standardResponse.body

  if (body instanceof ReadableStream) {
    httpAdapter.setHeader(res, 'standard-server', 'octet-stream')
    return new StreamableFile(Readable.fromWeb(body), {
      type: flattenStandardHeader(standardResponse.headers['content-type']) ?? 'application/octet-stream',
    })
  }

  if (isAsyncIteratorObject(body)) {
    return new StreamableFile(toEventStream(body, options?.eventStream), {
      type: 'text/event-stream',
    })
  }

  if (body instanceof Blob) {
    httpAdapter.setHeader(res, 'standard-server', 'file')
    return new StreamableFile(Readable.fromWeb(body.stream()), {
      type: body.type,
      disposition: flattenStandardHeader(standardResponse.headers['content-disposition'])
        ?? generateContentDisposition(body instanceof File ? body.name : 'blob'),
      length: Number.isFinite(body.size) ? body.size : undefined,
    })
  }

  if (body instanceof FormData) {
    const response = new Response(body)
    return new StreamableFile(Readable.fromWeb(response.body!), {
      type: response.headers.get('content-type')!,
    })
  }

  if (body instanceof URLSearchParams) {
    httpAdapter.setHeader(res, 'content-type', 'application/x-www-form-urlencoded')
    return body.toString()
  }

  if (body === undefined) {
    return body
  }

  httpAdapter.setHeader(res, 'content-type', 'application/json')
  return typeof body === 'string' || body === null
    ? stringifyJSON(body)
    : body
}
