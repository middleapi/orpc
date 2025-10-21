import type { StandardBody } from '@orpc/standard-server'
import type { ToEventIteratorOptions, ToEventStreamOptions } from './event-iterator'
import { isAsyncIteratorObject, isInSentryContext, parseEmptyableJSON, runWithSpan, stringifyJSON } from '@orpc/shared'
import { generateContentDisposition, getFilenameFromContentDisposition } from '@orpc/standard-server'
import { toEventIterator, toEventStream } from './event-iterator'

export interface ToStandardBodyOptions extends ToEventIteratorOptions { }

export function toStandardBody(
  re: Request | Response,
  options: ToStandardBodyOptions = {},
): Promise<StandardBody> {
  return runWithSpan(
    { name: 'parse_standard_body', signal: options.signal },
    async (span) => {
      if (isInSentryContext()) {
        span?.setAttribute('sentry.op', 'orpc')
      }
      const contentDisposition = re.headers.get('content-disposition')

      if (typeof contentDisposition === 'string') {
        const fileName = getFilenameFromContentDisposition(contentDisposition) ?? 'blob'

        const blob = await re.blob()
        return new File([blob], fileName, {
          type: blob.type,
        })
      }

      const contentType = re.headers.get('content-type')

      if (!contentType || contentType.startsWith('application/json')) {
        const text = await re.text()
        return parseEmptyableJSON(text)
      }

      if (contentType.startsWith('multipart/form-data')) {
        return await re.formData()
      }

      if (contentType.startsWith('application/x-www-form-urlencoded')) {
        const text = await re.text()
        return new URLSearchParams(text)
      }

      if (contentType.startsWith('text/event-stream')) {
        return toEventIterator(re.body, options)
      }

      if (contentType.startsWith('text/plain')) {
        return await re.text()
      }

      const blob = await re.blob()
      return new File([blob], 'blob', {
        type: blob.type,
      })
    },
  )
}

export interface ToFetchBodyOptions extends ToEventStreamOptions { }

/**
 * @param body
 * @param headers - The headers can be changed by the function and effects on the original headers.
 */
export function toFetchBody(
  body: StandardBody,
  headers: Headers,
  options: ToFetchBodyOptions = {},
): string | Blob | FormData | URLSearchParams | undefined | ReadableStream<Uint8Array> {
  const currentContentDisposition = headers.get('content-disposition')

  headers.delete('content-type')
  headers.delete('content-disposition')

  if (body === undefined) {
    return undefined
  }

  if (body instanceof Blob) {
    headers.set('content-type', body.type)
    headers.set('content-length', body.size.toString())
    headers.set(
      'content-disposition',
      currentContentDisposition ?? generateContentDisposition(body instanceof File ? body.name : 'blob'),
    )

    return body
  }

  if (body instanceof FormData) {
    return body
  }

  if (body instanceof URLSearchParams) {
    return body
  }

  if (isAsyncIteratorObject(body)) {
    headers.set('content-type', 'text/event-stream')

    return toEventStream(body, options)
  }

  headers.set('content-type', 'application/json')

  return stringifyJSON(body)
}
