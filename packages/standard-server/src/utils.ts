import type { StandardHeaders, StandardLazyResponse } from './types'
import { isAsyncIteratorObject, once, replicateAsyncIterator, toArray, tryDecodeURIComponent } from '@orpc/shared'

export function generateContentDisposition(filename: string, disposition: 'inline' | 'attachment' = 'inline'): string {
  const encodedFileName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"')

  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#encoding_for_content-disposition_and_link_headers
  const encodedFilenameStar = encodeURIComponent(filename)
    .replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/g, (str, hex) => String.fromCharCode(Number.parseInt(hex, 16)))

  return `${disposition}; filename="${encodedFileName}"; filename*=utf-8\'\'${encodedFilenameStar}`
}

export function getFilenameFromContentDisposition(contentDisposition: string): string | undefined {
  const encodedFilenameStarMatch = contentDisposition.match(/filename\*=(UTF-8'')?([^;]*)/i)

  if (encodedFilenameStarMatch && typeof encodedFilenameStarMatch[2] === 'string') {
    return tryDecodeURIComponent(encodedFilenameStarMatch[2])
  }

  const encodedFilenameMatch = contentDisposition.match(/filename="((?:\\"|[^"])*)"/i)
  if (encodedFilenameMatch && typeof encodedFilenameMatch[1] === 'string') {
    return encodedFilenameMatch[1].replace(/\\"/g, '"')
  }
}

export function mergeStandardHeaders(a: StandardHeaders, b: StandardHeaders): StandardHeaders {
  const merged = { ...a }

  for (const key in b) {
    if (Array.isArray(b[key])) {
      merged[key] = [...toArray(merged[key]), ...b[key]]
    }
    else if (b[key] !== undefined) {
      if (Array.isArray(merged[key])) {
        merged[key] = [...merged[key], b[key]]
      }
      else if (merged[key] !== undefined) {
        merged[key] = [merged[key], b[key]]
      }
      else {
        merged[key] = b[key]
      }
    }
  }

  return merged
}

export function flattenHeader(header: string | readonly string[] | undefined): string | undefined {
  if (typeof header === 'string' || header === undefined) {
    return header
  }

  if (header.length === 0) {
    return undefined
  }

  return header.join(', ')
}

export function replicateStandardLazyResponse(
  response: StandardLazyResponse,
  count: number,
): StandardLazyResponse[] {
  const replicated: StandardLazyResponse[] = []

  let bodyPromise: Promise<unknown> | undefined
  let replicatedAsyncIteratorObjects: AsyncIteratorObject<any, any, any>[] | undefined

  for (let i = 0; i < count; i++) {
    replicated.push({
      ...response,
      body: once(async () => {
        const body = await (bodyPromise ??= response.body())

        if (!isAsyncIteratorObject(body)) {
          return body
        }

        replicatedAsyncIteratorObjects ??= replicateAsyncIterator(body, count)
        return replicatedAsyncIteratorObjects.shift()
      }),
    })
  }

  return replicated
}

export function isEventIteratorHeaders(headers: StandardHeaders): boolean {
  return Boolean(flattenHeader(headers['content-type'])?.startsWith('text/event-stream') && flattenHeader(headers['content-disposition']) === undefined)
}
