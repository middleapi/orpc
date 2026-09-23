import type { Segment } from '@orpc/shared'
import { copyOnWrite, createLazyRegExp, isObject, isValidRegExpFlags } from '@orpc/shared'

export const STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES = {
  BIGINT: 0,
  DATE: 1,
  NAN: 2,
  UNDEFINED: 3,
  URL: 4,
  REGEXP: 5,
  SET: 6,
  MAP: 7,
} as const

export type StandardRPCJsonSerializedMetaItem = readonly [type: number, ...path: Segment[]]
export type StandardRPCJsonSerialized = [json: unknown, meta: StandardRPCJsonSerializedMetaItem[], maps: Segment[][], blobs: Blob[]]

export interface StandardRPCCustomJsonSerializer {
  type: number
  condition(data: unknown): boolean
  serialize(data: any): unknown
  /**
   * `serialized` comes from the wire, so validate its type and throw on mismatch.
   */
  deserialize(serialized: any): unknown
}

export interface StandardRPCJsonSerializerOptions {
  customJsonSerializers?: readonly StandardRPCCustomJsonSerializer[]
}

const BUILT_IN_TYPES: ReadonlySet<number> = new Set(Object.values(STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES))

const SERIALIZED_REGEXP_FORMAT = /^\/(.*)\/([a-z]*)$/

function invalidSerializedData(detail: string): TypeError {
  return new TypeError(`Invalid RPC serialized data: ${detail}`)
}

function invalidSerializedType(type: number, name: string, expected: string): TypeError {
  return invalidSerializedData(`type ${type} (${name}) expects ${expected}.`)
}

export class StandardRPCJsonSerializer {
  private readonly customSerializers: readonly StandardRPCCustomJsonSerializer[]

  constructor(options: StandardRPCJsonSerializerOptions = {}) {
    this.customSerializers = options.customJsonSerializers ?? []

    if (this.customSerializers.length !== new Set(this.customSerializers.map(custom => custom.type)).size) {
      throw new Error('Custom serializer type must be unique.')
    }
  }

  serialize(data: unknown, segments: Segment[] = [], meta: StandardRPCJsonSerializedMetaItem[] = [], maps: Segment[][] = [], blobs: Blob[] = []): StandardRPCJsonSerialized {
    for (const custom of this.customSerializers) {
      if (custom.condition(data)) {
        const result = this.serialize(custom.serialize(data), segments, meta, maps, blobs)

        meta.push([custom.type, ...segments])

        return result
      }
    }

    if (data instanceof Blob) {
      maps.push(segments)
      blobs.push(data)
      return [data, meta, maps, blobs]
    }

    if (typeof data === 'bigint') {
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.BIGINT, ...segments])
      return [data.toString(), meta, maps, blobs]
    }

    if (data instanceof Date) {
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.DATE, ...segments])

      if (Number.isNaN(data.getTime())) {
        return [null, meta, maps, blobs]
      }

      return [data.toISOString(), meta, maps, blobs]
    }

    if (Number.isNaN(data)) {
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.NAN, ...segments])
      return [null, meta, maps, blobs]
    }

    if (data instanceof URL) {
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.URL, ...segments])
      return [data.toString(), meta, maps, blobs]
    }

    if (data instanceof RegExp) {
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.REGEXP, ...segments])
      return [data.toString(), meta, maps, blobs]
    }

    if (data instanceof Set) {
      const result = this.serialize(Array.from(data), segments, meta, maps, blobs)
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.SET, ...segments])
      return result
    }

    if (data instanceof Map) {
      const result = this.serialize(Array.from(data.entries()), segments, meta, maps, blobs)
      meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.MAP, ...segments])
      return result
    }

    if (Array.isArray(data)) {
      const json = data.map((v, i) => {
        if (v === undefined) {
          meta.push([STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.UNDEFINED, ...segments, i])
          return null
        }

        return this.serialize(v, [...segments, i], meta, maps, blobs)[0]
      })

      return [json, meta, maps, blobs]
    }

    if (isObject(data)) {
      const json: Record<string, unknown> = {}

      for (const k in data) {
        /**
         * Skip custom toJSON methods to avoid JSON.stringify invoking them,
         * which could cause meta and serialized data mismatches during deserialization.
         * Instead, rely on custom serializers.
         */
        if (k === 'toJSON' && typeof data[k] === 'function') {
          continue
        }

        json[k] = this.serialize(data[k], [...segments, k], meta, maps, blobs)[0]
      }

      return [json, meta, maps, blobs]
    }

    return [data, meta, maps, blobs]
  }

  deserialize(json: unknown, meta: readonly StandardRPCJsonSerializedMetaItem[]): unknown
  deserialize(json: unknown, meta: readonly StandardRPCJsonSerializedMetaItem[], maps: readonly Segment[][], getBlob: (index: number) => Blob): unknown

  deserialize(json: unknown, meta: readonly StandardRPCJsonSerializedMetaItem[], maps?: readonly Segment[][], getBlob?: (index: number) => Blob): unknown {
    const ref = { data: json }
    /**
     * `input` is never written to, so `copyOnWrite` can tell a container still shared with
     * the caller's `json` from one already copied for a restored value.
     */
    const input = { data: json }

    if (maps && getBlob) {
      maps.forEach((segments, i) => {
        /**
         * `getBlob` hands back whatever the peer sent, such as a string FormData field.
         * A string like "4294967295" written to an array's `length` would resize it for later meta to iterate.
         */
        const blob: unknown = getBlob(i)

        if (!(blob instanceof Blob)) {
          throw invalidSerializedData(`blob ${i} is not a Blob.`)
        }

        let original: any = input
        let currentRef: any = ref
        let preSegment: string | number = 'data'

        segments.forEach((segment) => {
          original = original[preSegment]
          currentRef = copyOnWrite(currentRef, preSegment, original)
          preSegment = segment

          if (!Object.hasOwn(currentRef, preSegment)) {
            throw invalidSerializedData(`segment "${preSegment}" does not exist.`)
          }
        })

        currentRef[preSegment] = blob
      })
    }

    for (const item of meta) {
      const type = item[0]
      const custom = this.customSerializers.find(custom => custom.type === type)

      /**
       * Unknown types are ignored so a receiver without a custom serializer still gets plain data.
       * Skipping them before the path walk means no untrusted path is dereferenced for them.
       */
      if (custom === undefined && !BUILT_IN_TYPES.has(type)) {
        continue
      }

      let original: any = input
      let currentRef: any = ref
      let preSegment: string | number = 'data'

      for (let i = 1; i < item.length; i++) {
        original = original[preSegment]
        currentRef = copyOnWrite(currentRef, preSegment, original)
        preSegment = item[i]!

        if (!Object.hasOwn(currentRef, preSegment)) {
          throw invalidSerializedData(`segment "${preSegment}" does not exist.`)
        }
      }

      if (custom !== undefined) {
        currentRef[preSegment] = custom.deserialize(currentRef[preSegment])
        continue
      }

      const serialized: unknown = currentRef[preSegment]

      switch (type) {
        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.BIGINT:
          if (typeof serialized !== 'string') {
            throw invalidSerializedType(type, 'bigint', 'a string')
          }

          currentRef[preSegment] = BigInt(serialized)
          break

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.DATE:
          if (typeof serialized !== 'string' && serialized !== null) {
            throw invalidSerializedType(type, 'date', 'a string or null')
          }

          currentRef[preSegment] = new Date(serialized ?? Number.NaN)
          break

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.NAN:
          if (serialized !== null) {
            throw invalidSerializedType(type, 'nan', 'null')
          }

          currentRef[preSegment] = Number.NaN
          break

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.UNDEFINED:
          if (serialized !== null) {
            throw invalidSerializedType(type, 'undefined', 'null')
          }

          currentRef[preSegment] = undefined
          break

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.URL:
          if (typeof serialized !== 'string') {
            throw invalidSerializedType(type, 'url', 'a string')
          }

          currentRef[preSegment] = new URL(serialized)
          break

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.REGEXP: {
          if (typeof serialized !== 'string') {
            throw invalidSerializedType(type, 'regexp', 'a string')
          }

          const match = serialized.match(SERIALIZED_REGEXP_FORMAT)

          if (match === null || !isValidRegExpFlags(match[2]!)) {
            throw invalidSerializedData(`type ${type} (regexp) expects a "/pattern/flags" string.`)
          }

          /**
           * Compiling is deferred until the RegExp is used, so an attacker-supplied pattern
           * costs nothing unless the app touches it. Parse cost is engine-specific and not
           * limited to unicode mode: V8 spends microseconds per byte on `\p{...}` escapes,
           * and JavaScriptCore parses named capture groups quadratically without any flag.
           * A syntax error therefore surfaces at first use rather than at decode.
           */
          currentRef[preSegment] = createLazyRegExp(match[1]!, match[2]!)

          break
        }

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.SET:
          if (!Array.isArray(serialized)) {
            throw invalidSerializedType(type, 'set', 'an array')
          }

          currentRef[preSegment] = new Set(serialized)
          break

        case STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES.MAP:
          if (!Array.isArray(serialized)) {
            throw invalidSerializedType(type, 'map', 'an array')
          }

          currentRef[preSegment] = new Map(serialized)
          break
      }
    }

    return ref.data
  }
}
