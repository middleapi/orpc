import type { Buffer } from 'node:buffer'

// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** A model holding binary data, sent in a query string and in a request body */
export interface Attachment {
  data: Uint8Array
  size: number
}

/** Values the bracket notation of a query string sends as `String(value)`, at any depth */
export interface Filters {
  bytes: Uint8Array
  buffer: Buffer
  floats: Float64Array
  pattern: RegExp
  raw: ArrayBuffer
  view: DataView
  either: Uint8Array | string
  list: Uint8Array[]
  nested: { pattern: RegExp; count: number }
  attachment: Attachment
  at: Date
}

/** Parameters of values sent as strings, next to request bodies holding them */
export const parameterValues = {
  search: os
    .route({ method: 'GET', path: '/search' })
    .input(type<Filters>())
    .handler(() => 1),
  upload: os
    .route({ method: 'POST', path: '/upload' })
    .input(type<Attachment>())
    .handler(() => 1),
  detailed: os
    .route({ method: 'POST', path: '/detailed/{id}', inputStructure: 'detailed' })
    .input(
      type<{
        params: { id: Uint8Array }
        query: { pattern: RegExp; attachment: Attachment }
        body: { data: Uint8Array }
      }>(),
    )
    .handler(() => 1),
  path: os
    .route({ method: 'PUT', path: '/path/{pattern}' })
    .input(type<{ pattern: RegExp; data: Uint8Array }>())
    .handler(() => 1),
}
