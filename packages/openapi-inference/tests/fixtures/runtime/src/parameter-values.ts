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
  frozen: Readonly<RegExp>
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
  styled: os
    .route({
      method: 'GET',
      path: '/styled/{pairs}/{patterns}',
      queryStyles: {
        json: 'json',
        jsonPattern: 'json',
        jsonList: 'json',
        jsonHolder: 'json',
        comma: 'comma-delimited-object',
        space: 'space-delimited-object',
        pipe: 'pipe-delimited-object',
        array: 'array',
        commaArray: 'comma-delimited-array',
        pipeArray: 'pipe-delimited-array',
        reset: undefined,
      },
      paramsStyles: { pairs: 'comma-delimited-object', patterns: 'comma-delimited-array' },
    })
    .input(
      type<{
        pairs: Uint8Array
        patterns: RegExp
        json: Uint8Array
        jsonPattern: RegExp
        jsonList: Uint8Array[]
        jsonHolder: { bytes: Uint8Array; pattern: RegExp }
        comma: Uint8Array
        space: Uint8Array
        pipe: Uint8Array
        array: RegExp
        commaArray: RegExp
        pipeArray: RegExp
        reset: Uint8Array
        plain: Uint8Array
      }>(),
    )
    .handler(() => 1),
  styledDetailed: os
    .route({
      method: 'GET',
      path: '/styled-detailed/{pairs}',
      inputStructure: 'detailed',
      queryStyles: { json: 'json' },
      paramsStyles: { pairs: 'comma-delimited-object' },
    })
    .input(
      type<{
        params: { pairs: Uint8Array }
        query: { json: Uint8Array[]; pattern: RegExp }
      }>(),
    )
    .handler(() => 1),
  styledPath: os
    .route({
      method: 'PUT',
      path: '/styled-path/{pairs}/{pattern}',
      paramsStyles: { pairs: 'comma-delimited-object' },
    })
    .input(type<{ pairs: Uint8Array; pattern: RegExp; data: Uint8Array }>())
    .handler(() => 1),
}

/** Optional inputs whose fields are sent with bracket notation, but for those of a style */
export const optionalParameterValues = {
  styled: os
    .route({ method: 'GET', path: '/styled', queryStyles: { json: 'json' } })
    .input(type<{ json: Uint8Array; pattern: RegExp } | undefined>())
    .handler(() => 1),
  styledDetailed: os
    .route({
      method: 'GET',
      path: '/styled-detailed',
      inputStructure: 'detailed',
      queryStyles: { json: 'json' },
    })
    .input(type<{ query?: { json: Uint8Array; pattern: RegExp } }>())
    .handler(() => 1),
}
