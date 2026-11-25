import type { EventMeta, StandardBody, StandardHeaders, StandardRequest, StandardResponse } from '@orpc/standard-server'
import type { EncodedMessage } from './types'
import { isAsyncIteratorObject, readAsBuffer, stringifyJSON } from '@orpc/shared'
import { flattenHeader, generateContentDisposition, getFilenameFromContentDisposition } from '@orpc/standard-server'

const SHORTABLE_ORIGIN = 'http://orpc'
const SHORTABLE_ORIGIN_MATCHER = /^http:\/\/orpc\//

export enum MessageType {
  REQUEST = 1,
  RESPONSE = 2,
  EVENT_ITERATOR = 3,
  ABORT_SIGNAL = 4,
}

export type EventIteratorEvent = 'message' | 'error' | 'done'

export interface EventIteratorPayload {
  event: EventIteratorEvent
  data: unknown
  meta?: EventMeta
}

export interface RequestMessageMap {
  [MessageType.REQUEST]: Omit<StandardRequest, 'signal'>
  [MessageType.EVENT_ITERATOR]: EventIteratorPayload
  [MessageType.ABORT_SIGNAL]: void
}

export interface ResponseMessageMap {
  [MessageType.RESPONSE]: StandardResponse
  [MessageType.EVENT_ITERATOR]: EventIteratorPayload
  [MessageType.ABORT_SIGNAL]: void
}

export interface BaseMessageFormat<P = unknown> {
  /**
   * Client-guaranteed unique identifier
   */
  i: string

  /**
   * @default REQUEST | RESPONSE
   */
  t?: MessageType

  p: P
}

export interface SerializedEventIteratorPayload {
  e: EventIteratorEvent
  d: unknown
  m?: EventMeta
}

export interface SerializedRequestPayload {
  /**
   * The url of the request
   *
   * might be relative path if origin is `http://orpc`
   */
  u: string

  b: StandardBody

  /**
   * @default {}
   */
  h?: StandardHeaders

  /**
   * @default POST
   */
  m?: string
}

export interface SerializedResponsePayload {
  /**
   * @default 200
   */
  s?: number

  /**
   * @default {}
   */
  h?: StandardHeaders

  b: StandardBody
}

export type DecodedMessageUnion<TMap extends RequestMessageMap | ResponseMessageMap> = {
  [K in keyof TMap]: [id: string, type: K, payload: TMap[K]]
}[keyof TMap]

export type DecodedRequestMessage = DecodedMessageUnion<RequestMessageMap>
export type DecodedResponseMessage = DecodedMessageUnion<ResponseMessageMap>

/**
 * New serialization functions without Blob handling
 */
export function serializeRequestMessage<T extends keyof RequestMessageMap>(
  id: string,
  type: T,
  payload: RequestMessageMap[T],
): BaseMessageFormat {
  if (type === MessageType.EVENT_ITERATOR) {
    const eventPayload = payload as EventIteratorPayload
    const serializedPayload: SerializedEventIteratorPayload = {
      e: eventPayload.event,
      d: eventPayload.data,
      m: eventPayload.meta,
    }

    return { i: id, t: type, p: serializedPayload }
  }

  if (type === MessageType.ABORT_SIGNAL) {
    return { i: id, t: type, p: payload }
  }

  const request = payload as RequestMessageMap[MessageType.REQUEST]

  const serializedPayload: SerializedRequestPayload = {
    u: request.url.toString().replace(SHORTABLE_ORIGIN_MATCHER, '/'),
    b: request.body,
    h: Object.keys(request.headers).length > 0 ? request.headers : undefined,
    m: request.method === 'POST' ? undefined : request.method,
  }

  return {
    i: id,
    p: serializedPayload,
  }
}

export function deserializeRequestMessage(message: BaseMessageFormat): DecodedRequestMessage {
  const id: string = message.i
  const type: MessageType = message.t ?? MessageType.REQUEST

  if (type === MessageType.EVENT_ITERATOR) {
    const payload = message.p as SerializedEventIteratorPayload

    return [id, type, { event: payload.e, data: payload.d, meta: payload.m }]
  }

  if (type === MessageType.ABORT_SIGNAL) {
    return [id, type, message.p as undefined]
  }

  const payload = message.p as SerializedRequestPayload

  return [id, MessageType.REQUEST, {
    url: payload.u.startsWith('/') ? new URL(`${SHORTABLE_ORIGIN}${payload.u}`) : new URL(payload.u),
    headers: payload.h ?? {},
    method: payload.m ?? 'POST',
    body: payload.b,
  }]
}

export function serializeResponseMessage<T extends keyof ResponseMessageMap>(
  id: string,
  type: T,
  payload: ResponseMessageMap[T],
): BaseMessageFormat {
  if (type === MessageType.EVENT_ITERATOR) {
    const eventPayload = payload as EventIteratorPayload
    const serializedPayload: SerializedEventIteratorPayload = {
      e: eventPayload.event,
      d: eventPayload.data,
      m: eventPayload.meta,
    }
    return { i: id, t: type, p: serializedPayload }
  }

  if (type === MessageType.ABORT_SIGNAL) {
    return { i: id, t: type, p: undefined }
  }

  const response = payload as StandardResponse

  const serializedPayload: SerializedResponsePayload = {
    s: response.status === 200 ? undefined : response.status,
    h: Object.keys(response.headers).length > 0 ? response.headers : undefined,
    b: response.body,
  }

  return {
    i: id,
    p: serializedPayload,
  }
}

export function deserializeResponseMessage(message: BaseMessageFormat): DecodedResponseMessage {
  const id: string = message.i
  const type: MessageType | undefined = message.t

  if (type === MessageType.EVENT_ITERATOR) {
    const payload = message.p as SerializedEventIteratorPayload

    return [id, type, { event: payload.e, data: payload.d, meta: payload.m }]
  }

  if (type === MessageType.ABORT_SIGNAL) {
    return [id, type, message.p as undefined]
  }

  const payload = message.p as SerializedResponsePayload

  return [id, MessageType.RESPONSE, {
    status: payload.s ?? 200,
    headers: payload.h ?? {},
    body: payload.b,
  }]
}

/**
 * Original encode/decode functions now using the new serialize/deserialize functions
 */

export async function encodeRequestMessage<T extends keyof RequestMessageMap>(
  id: string,
  type: T,
  payload: RequestMessageMap[T],
): Promise<EncodedMessage> {
  if (type === MessageType.EVENT_ITERATOR || type === MessageType.ABORT_SIGNAL) {
    return encodeRawMessage(serializeRequestMessage(id, type, payload))
  }

  const request = payload as RequestMessageMap[MessageType.REQUEST]

  const { body: processedBody, headers: processedHeaders } = await serializeBodyAndHeaders(
    request.body,
    request.headers,
  )

  const modifiedRequest: RequestMessageMap[MessageType.REQUEST] = {
    ...request,
    body: processedBody instanceof Blob ? undefined : processedBody,
    headers: processedHeaders,
  }

  const baseMessage = serializeRequestMessage(id, MessageType.REQUEST, modifiedRequest)

  if (processedBody instanceof Blob) {
    return encodeRawMessage(baseMessage, processedBody)
  }

  return encodeRawMessage(baseMessage)
}

export async function decodeRequestMessage(raw: EncodedMessage): Promise<DecodedRequestMessage> {
  const { json: message, buffer } = await decodeRawMessage(raw)

  const [id, type, payload] = deserializeRequestMessage(message)

  if (type === MessageType.EVENT_ITERATOR || type === MessageType.ABORT_SIGNAL) {
    return [id, type, payload as any]
  }

  const request = payload as RequestMessageMap[MessageType.REQUEST]
  const body = await deserializeBody(request.headers, request.body, buffer)

  return [id, type, { ...request, body }]
}

export async function encodeResponseMessage<T extends keyof ResponseMessageMap>(
  id: string,
  type: T,
  payload: ResponseMessageMap[T],
): Promise<EncodedMessage> {
  if (type === MessageType.EVENT_ITERATOR || type === MessageType.ABORT_SIGNAL) {
    return encodeRawMessage(serializeResponseMessage(id, type, payload))
  }

  const response = payload as StandardResponse
  const { body: processedBody, headers: processedHeaders } = await serializeBodyAndHeaders(
    response.body,
    response.headers,
  )

  const modifiedResponse: StandardResponse = {
    ...response,
    body: processedBody instanceof Blob ? undefined : processedBody,
    headers: processedHeaders,
  }

  const baseMessage = serializeResponseMessage(id, MessageType.RESPONSE, modifiedResponse)

  if (processedBody instanceof Blob) {
    return encodeRawMessage(baseMessage, processedBody)
  }

  return encodeRawMessage(baseMessage)
}

export async function decodeResponseMessage(raw: EncodedMessage): Promise<DecodedResponseMessage> {
  const { json: message, buffer } = await decodeRawMessage(raw)

  const [id, type, payload] = deserializeResponseMessage(message)

  if (type === MessageType.EVENT_ITERATOR || type === MessageType.ABORT_SIGNAL) {
    return [id, type, payload as any]
  }

  const response = payload as StandardResponse
  const body = await deserializeBody(response.headers, response.body, buffer)

  return [id, type, { ...response, body }]
}

/**
 * Helper to deal with body and headers
 */

async function serializeBodyAndHeaders(
  body: StandardBody,
  originalHeaders: StandardHeaders | undefined,
): Promise<{ body: StandardBody | Blob | string | undefined, headers: StandardHeaders }> {
  const headers: StandardHeaders = { ...originalHeaders }

  const originalContentDisposition = headers['content-disposition']
  delete headers['content-type']
  delete headers['content-disposition']

  if (body instanceof Blob) {
    headers['content-type'] = body.type
    headers['content-disposition'] = originalContentDisposition ?? generateContentDisposition(
      body instanceof File ? body.name : 'blob',
    )

    return { body, headers }
  }

  if (body instanceof FormData) {
    const tempRes = new Response(body)
    headers['content-type'] = tempRes.headers.get('content-type')!
    const formDataBlob = await tempRes.blob()
    return { body: formDataBlob, headers }
  }

  if (body instanceof URLSearchParams) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    return { body: body.toString(), headers }
  }

  if (isAsyncIteratorObject(body)) {
    headers['content-type'] = 'text/event-stream'
    return { body: undefined, headers }
  }

  return { body, headers }
}

async function deserializeBody(headers: StandardHeaders, body: unknown, buffer: Uint8Array | undefined): Promise<StandardBody> {
  const contentType = flattenHeader(headers['content-type'])
  const contentDisposition = flattenHeader(headers['content-disposition'])

  if (typeof contentDisposition === 'string') {
    const filename = getFilenameFromContentDisposition(contentDisposition) ?? 'blob'
    return new File(buffer === undefined ? [] : [buffer], filename, { type: contentType })
  }

  if (contentType?.startsWith('multipart/form-data')) {
    const tempRes = new Response(buffer, { headers: { 'content-type': contentType } })
    return tempRes.formData()
  }

  if (contentType?.startsWith('application/x-www-form-urlencoded') && typeof body === 'string') {
    return new URLSearchParams(body)
  }

  return body
}

/**
 * A 16-byte sentinel of 0xFF values guaranteed never to collide with UTF-8 JSON text,
 * since TextEncoder.encode never emits 0xFF (it's invalid in UTF-8).
 * We use this as an unambiguous boundary between the JSON payload and any appended binary data.
 */
const JSON_AND_BINARY_DELIMITER = 0xFF

async function encodeRawMessage(data: object, blob?: Blob): Promise<EncodedMessage> {
  const json = stringifyJSON(data)

  if (blob === undefined || blob.size === 0) {
    return json
  }

  return readAsBuffer(new Blob([
    new TextEncoder().encode(json),
    new Uint8Array([JSON_AND_BINARY_DELIMITER]),
    blob,
  ]))
}

async function decodeRawMessage(raw: EncodedMessage): Promise<{ json: any, buffer?: Uint8Array }> {
  if (typeof raw === 'string') {
    return { json: JSON.parse(raw) }
  }

  const buffer = raw instanceof Uint8Array ? raw : new Uint8Array(raw)

  const delimiterIndex = buffer.indexOf(JSON_AND_BINARY_DELIMITER)

  if (delimiterIndex === -1) {
    const jsonPart = new TextDecoder().decode(buffer)
    return { json: JSON.parse(jsonPart) }
  }

  const jsonPart = new TextDecoder().decode(buffer.subarray(0, delimiterIndex))
  const bufferPart = buffer.subarray(delimiterIndex + 1)

  return {
    json: JSON.parse(jsonPart),
    buffer: bufferPart,
  }
}
