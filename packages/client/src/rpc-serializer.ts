import {
  isAsyncIteratorObject,
  isPlainObject,
  NON_NEGATIVE_INTEGER_REGEX,
  stringifyJSON,
} from '@orpc/shared'
import type { StandardBody } from '@standard-server/core'
import { EventStreamErrorEvent } from '@standard-server/core'

import { wrapAsyncIteratorPreservingEventMeta } from './async-iterator-object'
import { createORPCErrorFromJson, isORPCErrorJson, toORPCError } from './error-utils'
import type { RPCJsonSerialization, RPCJsonSerializerOptions } from './rpc-json-serializer'
import { RPCJsonSerializer } from './rpc-json-serializer'

export interface RPCSerializerSerializeOptions {
  /**
   * Use FormData for serialization when nested blobs are present.
   * Does not apply to root-level Blob values.
   *
   * @default true
   */
  useFormDataForBlobFields?: boolean | undefined
}

export interface RPCSerializerOptions extends RPCJsonSerializerOptions {
  /**
   * Default options for serialize method
   */
  serialize?: RPCSerializerSerializeOptions | undefined
}

/**
 * Serializes and deserializes data for the RPC protocol,
 * preserving native types like Date, BigInt, Set, and Map that plain JSON cannot represent.
 *
 * @see {@link https://orpc.dev/docs/rpc/serializer | RPC Serializer}
 */
export class RPCSerializer extends RPCJsonSerializer {
  private readonly defaultSerializeOptions: RPCSerializerOptions['serialize']

  constructor(options: RPCSerializerOptions = {}) {
    super(options)
    this.defaultSerializeOptions = options.serialize
  }

  serialize(data: unknown, options: RPCSerializerSerializeOptions = {}): StandardBody {
    // standard body already supports these types without additional serialization.
    if (data === undefined || data instanceof ReadableStream || data instanceof Blob) {
      return data
    }

    if (isAsyncIteratorObject(data)) {
      return wrapAsyncIteratorPreservingEventMeta(data, {
        mapResult: (result) => {
          // standard event stream data already supports these types without additional serialization.
          if (result.value === undefined) {
            return result
          }

          return { done: result.done, value: this.serializePayload(result.value, false) }
        },
        mapError: (e) =>
          new EventStreamErrorEvent(this.serializePayload(toORPCError(e).toJSON(), false), {
            cause: e,
          }),
      })
    }

    const useFormDataForBlobs =
      options.useFormDataForBlobFields ??
      this.defaultSerializeOptions?.useFormDataForBlobFields ??
      true
    return this.serializePayload(data, useFormDataForBlobs)
  }

  private serializePayload(data: unknown, useFormDataForBlobs: boolean): unknown {
    const { json, meta, maps, blobs } = this.serializeJson(data)

    if (!useFormDataForBlobs || !blobs?.length) {
      return { json, meta }
    }

    const form = new FormData()

    form.set('data', stringifyJSON({ json, meta, maps }))

    blobs.forEach((blob, i) => {
      form.set(i.toString(), blob)
    })

    return form
  }

  deserialize(data: StandardBody): unknown {
    if (data === undefined || data instanceof ReadableStream || data instanceof Blob) {
      return data
    }

    if (isAsyncIteratorObject(data)) {
      return wrapAsyncIteratorPreservingEventMeta(data, {
        mapResult: (result) => {
          if (result.value === undefined) {
            return result
          }

          return { done: result.done, value: this.deserializePayload(result.value) }
        },
        mapError: (e) => {
          if (!(e instanceof EventStreamErrorEvent) || e.data === undefined) {
            return e
          }

          let deserialized: unknown

          try {
            deserialized = this.deserializePayload(e.data)
          } catch {
            return e
          }

          if (isORPCErrorJson(deserialized)) {
            return createORPCErrorFromJson(deserialized, { cause: e })
          }

          return new EventStreamErrorEvent(deserialized, { cause: e })
        },
      })
    }

    return this.deserializePayload(data)
  }

  private deserializePayload(data: unknown): unknown {
    if (!(data instanceof FormData)) {
      return this.deserializeJson(assertEnvelope(data, false))
    }

    let raw: string | undefined
    let hasBlobs = false
    const blobs: Blob[] = []

    for (const [key, value] of data) {
      if (key === 'data' && raw === undefined && typeof value === 'string') {
        raw = value
      } else if (value instanceof Blob && NON_NEGATIVE_INTEGER_REGEX.test(key)) {
        blobs[Number(key)] = value
        hasBlobs = true
      } else {
        throw invalidFormat()
      }
    }

    const serialized =
      raw === undefined ? { json: undefined } : assertEnvelope(JSON.parse(raw), true)

    if (hasBlobs && serialized.maps === undefined) {
      throw invalidFormat()
    }

    return this.deserializeJson({ ...serialized, blobs } as RPCJsonSerialization)
  }
}

function invalidFormat(): TypeError {
  return new TypeError('Invalid RPC serialized data format.')
}

function assertEnvelope(value: unknown, allowMaps: boolean): RPCJsonSerialization {
  if (!isPlainObject(value)) {
    throw invalidFormat()
  }

  for (const key of Object.keys(value)) {
    if (key !== 'json' && key !== 'meta' && (!allowMaps || key !== 'maps')) {
      throw invalidFormat()
    }
  }

  if (
    (value.meta !== undefined && !Array.isArray(value.meta)) ||
    (value.maps !== undefined && !Array.isArray(value.maps))
  ) {
    throw invalidFormat()
  }

  return value as RPCJsonSerialization
}
