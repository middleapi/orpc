import type { Segment } from '@orpc/shared'
import { isPlainObject } from '@orpc/shared'

export type RPCJsonSerializationMeta = [type: string, ...path: Segment[]]
export type RPCJsonSerialization
  = | { json: unknown, meta?: RPCJsonSerializationMeta[] | undefined, maps?: undefined, blobs?: undefined }
    | { json: unknown, meta?: RPCJsonSerializationMeta[] | undefined, maps: Segment[][], blobs: Blob[] }

export interface RPCJsonSerializerHandler {
  condition(value: unknown): boolean
  serialize(value: any): unknown
  deserialize(serialized: any): unknown
  /**
   * If false, the result of this serializer will not be further processed by other serializers,
   * even if it matches their conditions and treat it as final serialized value.
   * This can be useful for serializers that return primitive values, which should not be further processed.
   * to improve performance and avoid potential issues with other serializers.
   *
   * @default false
   */
  isTerminal?: boolean
}

const REGEX_STRING_PATTERN = /^\/(.*)\/([a-z]*)$/

const DEFAULT_RPC_JSON_SERIALIZER_HANDLERS: Record<string, RPCJsonSerializerHandler> = {
  undefined: {
    condition(data: unknown): boolean {
      return data === undefined
    },
    serialize() {
      return null
    },
    deserialize() {
      return undefined
    },
    isTerminal: true,
  },
  bigint: {
    condition(data: unknown): boolean {
      return typeof data === 'bigint'
    },
    serialize(data: bigint): string {
      return data.toString()
    },
    deserialize(serialized: string): bigint {
      return BigInt(serialized)
    },
    isTerminal: true,
  },
  date: {
    condition(data: unknown): boolean {
      return data instanceof Date
    },
    serialize(data: Date): string | null {
      if (Number.isNaN(data.getTime())) {
        return null
      }

      return data.toISOString()
    },
    deserialize(serialized: string | null): Date {
      return new Date(serialized ?? 'Invalid Date')
    },
    isTerminal: true,
  },
  nan: {
    condition(data: unknown): boolean {
      return typeof data === 'number' && Number.isNaN(data)
    },
    serialize() {
      return null
    },
    deserialize() {
      return Number.NaN
    },
    isTerminal: true,
  },
  url: {
    condition(data: unknown): boolean {
      return data instanceof URL
    },
    serialize(data: URL): string {
      return data.toString()
    },
    deserialize(serialized: string): URL {
      return new URL(serialized)
    },
    isTerminal: true,
  },
  regexp: {
    condition(data: unknown): boolean {
      return data instanceof RegExp
    },
    serialize(data: RegExp): string {
      return data.toString()
    },
    deserialize(serialized: string): RegExp {
      const [, pattern, flags] = serialized.match(REGEX_STRING_PATTERN)!
      return new RegExp(pattern!, flags)
    },
    isTerminal: true,
  },
  set: {
    condition(data: unknown): boolean {
      return data instanceof Set
    },
    serialize(data: Set<unknown>): unknown[] {
      return Array.from(data)
    },
    deserialize(serialized: unknown[]): Set<unknown> {
      return new Set(serialized)
    },
  },
  map: {
    condition(data: unknown): boolean {
      return data instanceof Map
    },
    serialize(data: Map<unknown, unknown>): unknown[] {
      return Array.from(data.entries())
    },
    deserialize(serialized: [unknown, unknown][]): Map<unknown, unknown> {
      return new Map(serialized)
    },
  },
}

export interface RPCJsonSerializerOptions {
  /**
   * Extend or override the built-in type handlers used during serialization and deserialization.
   *
   * Each key is a unique type identifier (e.g. `"date"`, `"bigint"`) and maps to a handler
   * that defines how to detect, serialize, and deserialize values of that type.
   *
   * **Extending:** Add new keys to support custom types:
   * ```ts
   * handlers: {
   *   buffer: {
   *     condition: (v) => v instanceof Buffer,
   *     serialize: (v: Buffer) => v.toString('base64'),
   *     deserialize: (s: string) => Buffer.from(s, 'base64'),
   *     isTerminal: true,
   *   }
   * }
   * ```
   *
   * **Overriding:** Use an existing key to replace a built-in handler:
   * ```ts
   * handlers: {
   *   date: {
   *     condition: (v) => v instanceof Date,
   *     serialize: (v: Date) => v.getTime(),
   *     deserialize: (n: number) => new Date(n),
   *     isTerminal: true,
   *   }
   * }
   * ```
   *
   * **Disabling:** Set a key to `undefined` to remove a built-in handler:
   * ```ts
   * handlers: { regexp: undefined }
   * ```
   *
   * Built-in type keys: `undefined`, `bigint`, `date`, `nan`, `url`, `regexp`, `set`, `map`.
   */
  handlers?: Record<string, undefined | RPCJsonSerializerHandler> | undefined

  /**
   * If true, properties with undefined values will be omitted during serialization.
   *
   * @default true
   */
  omitUndefinedProperties?: boolean | undefined
}

export class RPCJsonSerializer {
  private readonly handlers: Exclude<RPCJsonSerializerOptions['handlers'], undefined>
  private readonly omitUndefinedProperties: boolean

  constructor(options: RPCJsonSerializerOptions = {}) {
    this.handlers = {
      ...DEFAULT_RPC_JSON_SERIALIZER_HANDLERS,
      ...options.handlers,
    }

    this.omitUndefinedProperties = options.omitUndefinedProperties !== false
  }

  serialize(data: unknown): RPCJsonSerialization {
    const [json, meta_, maps, blobs] = this.serializeValue(data, [], [], [], [])

    const meta = meta_.length === 0 ? undefined : meta_

    if (maps.length === 0) {
      return { json, meta }
    }

    return { json, meta, maps, blobs }
  }

  private serializeValue(data: unknown, segments: Segment[], meta: RPCJsonSerializationMeta[], maps: Segment[][], blobs: Blob[]): [unknown, RPCJsonSerializationMeta[], Segment[][], Blob[]] {
    for (const key in this.handlers) {
      const handler = this.handlers[key]

      if (handler && handler.condition(data)) {
        const serialized = handler.serialize(data)

        if (handler.isTerminal) {
          meta.push([key, ...segments])
          return [serialized, meta, maps, blobs]
        }

        const result = this.serializeValue(serialized, segments, meta, maps, blobs)
        meta.push([key, ...segments])
        return result
      }
    }

    if (data instanceof Blob) {
      maps.push(segments)
      blobs.push(data)
      return [data, meta, maps, blobs]
    }

    if (Array.isArray(data)) {
      const json = data.map((v, i) => {
        return this.serializeValue(v, [...segments, i], meta, maps, blobs)[0]
      })

      return [json, meta, maps, blobs]
    }

    if (isPlainObject(data)) {
      const json: Record<string, unknown> = {}

      for (const k in data) {
        const v = data[k]
        /**
         * Skip custom toJSON methods to avoid JSON.stringify invoking them,
         * which could cause meta and serialized data mismatches during deserialization.
         * Instead, rely on custom handlers.
         */
        if (k === 'toJSON' && typeof v === 'function') {
          continue
        }

        if (v === undefined && this.omitUndefinedProperties) {
          continue
        }

        json[k] = this.serializeValue(v, [...segments, k], meta, maps, blobs)[0]
      }

      return [json, meta, maps, blobs]
    }

    return [data, meta, maps, blobs]
  }

  deserialize(serialized: RPCJsonSerialization): unknown {
    const ref = { data: serialized.json }

    if (serialized.blobs?.length) {
      serialized.maps.forEach((segments, i) => {
        let currentRef: any = ref
        let preSegment: string | number = 'data'

        segments.forEach((segment) => {
          currentRef = currentRef[preSegment]
          preSegment = segment

          if (!Object.hasOwn(currentRef, preSegment)) {
            throw new Error(`Security error: Invalid serialized data. Segment "${preSegment}" does not exist.`)
          }
        })

        currentRef[preSegment] = serialized.blobs[i]
      })
    }

    serialized.meta?.forEach((item) => {
      const type = item[0]

      let currentRef: any = ref
      let preSegment: string | number = 'data'

      for (let i = 1; i < item.length; i++) {
        currentRef = currentRef[preSegment]
        preSegment = item[i]!

        if (!Object.hasOwn(currentRef, preSegment)) {
          throw new Error(`Security error: Invalid serialized data. Segment "${preSegment}" does not exist.`)
        }
      }

      currentRef[preSegment] = this.handlers[type]!.deserialize(currentRef[preSegment])
    })

    return ref.data
  }
}
