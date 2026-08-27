import type { Segment } from '@orpc/shared'
import { isPlainObject, NullProtoObj } from '@orpc/shared'

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

const REGEX_STRING_PATTERN = /^\/([\s\S]*)\/([a-z]*)$/

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

/**
 * Serializes and deserializes native types like Date, BigInt, Set, and Map
 * into a JSON value plus separate metadata describing how to restore them.
 *
 * @see {@link https://orpc.dev/docs/integrations/tanstack-query#custom-serializers | TanStack Query Integration - Custom Serializers}
 */
export class RPCJsonSerializer {
  private readonly handlers: Exclude<RPCJsonSerializerOptions['handlers'], undefined>
  private readonly inlineBuiltInHandlers: boolean
  private readonly handlerEntries: [string, RPCJsonSerializerHandler][] | undefined
  private readonly omitUndefinedProperties: boolean

  constructor(options: RPCJsonSerializerOptions = {}) {
    this.omitUndefinedProperties = options.omitUndefinedProperties !== false
    this.handlers = Object.assign(new NullProtoObj(), DEFAULT_RPC_JSON_SERIALIZER_HANDLERS)
    const customHandlers = options.handlers

    if (customHandlers === undefined) {
      this.inlineBuiltInHandlers = true
      return
    }

    let inlineBuiltInHandlers = true
    let handlerEntries: [string, RPCJsonSerializerHandler][] = []

    for (const key in customHandlers) {
      const handler = customHandlers[key]
      this.handlers[key] = handler

      if (inlineBuiltInHandlers && key in DEFAULT_RPC_JSON_SERIALIZER_HANDLERS) {
        inlineBuiltInHandlers = false
      }

      if (inlineBuiltInHandlers && handler !== undefined) {
        handlerEntries.push([key, handler])
      }
    }

    if (!inlineBuiltInHandlers) {
      handlerEntries = []
      for (const key in this.handlers) {
        const handler = this.handlers[key]
        if (handler !== undefined) {
          handlerEntries.push([key, handler])
        }
      }
    }

    this.inlineBuiltInHandlers = inlineBuiltInHandlers
    this.handlerEntries = handlerEntries
  }

  serialize(data: unknown): RPCJsonSerialization {
    let meta: RPCJsonSerializationMeta[] | undefined = []
    const maps: Segment[][] = []
    const blobs: Blob[] = []

    const json = this.serializeValue(data, [], meta, maps, blobs)

    meta = meta.length === 0 ? undefined : meta

    if (maps.length === 0) {
      return { json, meta }
    }

    return { json, meta, maps, blobs }
  }

  /**
   * `segments` is a shared mutable stack (push/pop while walking),
   * so it must be copied before being stored in `meta` or `maps`.
   */
  private serializeValue(data: unknown, segments: Segment[], meta: RPCJsonSerializationMeta[], maps: Segment[][], blobs: Blob[]): unknown {
    /**
     * Inlined version of DEFAULT_RPC_JSON_SERIALIZER_HANDLERS: primitives are
     * dispatched on typeof and skip every handler condition check.
     * Must match the built-in handlers exactly.
     */
    if (this.inlineBuiltInHandlers) {
      switch (typeof data) {
        case 'string':
        case 'boolean':
          return data
        case 'number':
          if (Number.isNaN(data)) {
            meta.push(['nan', ...segments])
            return null
          }
          return data
        case 'undefined':
          meta.push(['undefined', ...segments])
          return null
        case 'bigint':
          meta.push(['bigint', ...segments])
          return data.toString()
        case 'object': {
          if (data === null) {
            return data
          }
          if (data instanceof Date) {
            meta.push(['date', ...segments])
            return Number.isNaN(data.getTime()) ? null : data.toISOString()
          }
          if (data instanceof URL) {
            meta.push(['url', ...segments])
            return data.toString()
          }
          if (data instanceof RegExp) {
            meta.push(['regexp', ...segments])
            return data.toString()
          }
          if (data instanceof Set) {
            const result = this.serializeValue(Array.from(data), segments, meta, maps, blobs)
            meta.push(['set', ...segments])
            return result
          }
          if (data instanceof Map) {
            const result = this.serializeValue(Array.from(data.entries()), segments, meta, maps, blobs)
            meta.push(['map', ...segments])
            return result
          }
        }
      }
    }

    const handlerEntries = this.handlerEntries
    if (handlerEntries) {
      for (let i = 0; i < handlerEntries.length; i++) {
        const entry = handlerEntries[i]!
        const handler = entry[1]

        if (handler.condition(data)) {
          const serialized = handler.serialize(data)

          if (handler.isTerminal) {
            meta.push([entry[0], ...segments])

            if (serialized instanceof Blob) {
              maps.push(segments.slice())
              blobs.push(serialized)
            }

            return serialized
          }

          const result = this.serializeValue(serialized, segments, meta, maps, blobs)
          meta.push([entry[0], ...segments])
          return result
        }
      }
    }

    if (data instanceof Blob) {
      maps.push(segments.slice())
      blobs.push(data)
      return data
    }

    if (Array.isArray(data)) {
      const json: unknown[] = []

      for (let i = 0; i < data.length; i++) {
        segments.push(i)
        json.push(this.serializeValue(data[i], segments, meta, maps, blobs))
        segments.pop()
      }

      return json
    }

    if (isPlainObject(data)) {
      const json: Record<string, unknown> = new NullProtoObj()

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

        segments.push(k)
        json[k] = this.serializeValue(v, segments, meta, maps, blobs)
        segments.pop()
      }

      return json
    }

    return data
  }

  deserialize(serialized: RPCJsonSerialization): unknown {
    const ref = { data: serialized.json }

    if (serialized.blobs?.length) {
      for (let i = 0; i < serialized.maps.length; i++) {
        const segments = serialized.maps[i]!

        let currentRef: any = ref
        let preSegment: string | number = 'data'

        for (let j = 0; j < segments.length; j++) {
          currentRef = currentRef[preSegment]
          preSegment = segments[j]!

          if (!Object.hasOwn(currentRef, preSegment)) {
            throw new Error(`Security error: Invalid serialized data. Segment "${preSegment}" does not exist.`)
          }
        }

        currentRef[preSegment] = serialized.blobs[i]
      }
    }

    if (serialized.meta) {
      for (const item of serialized.meta) {
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
      }
    }

    return ref.data
  }
}
