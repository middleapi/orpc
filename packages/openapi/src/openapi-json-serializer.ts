import type { Segment } from '@orpc/shared'
import { isPlainObject } from '@orpc/shared'

export type OpenAPIJsonSerialization
  = | { json: unknown, maps?: undefined, blobs?: undefined }
    | { json: unknown, maps: Segment[][], blobs: Blob[] }

export interface OpenAPIJsonSerializerHandler {
  condition(value: unknown): boolean
  serialize(value: any): unknown
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

const DEFAULT_OPEN_API_JSON_SERIALIZER_HANDLERS: Record<string, OpenAPIJsonSerializerHandler> = {
  undefined: {
    condition(data: unknown): boolean {
      return data === undefined
    },
    serialize() {
      return null
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
    isTerminal: true,
  },
  nan: {
    condition(data: unknown): boolean {
      return typeof data === 'number' && Number.isNaN(data)
    },
    serialize() {
      return null
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
    isTerminal: true,
  },
  regexp: {
    condition(data: unknown): boolean {
      return data instanceof RegExp
    },
    serialize(data: RegExp): string {
      return data.toString()
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
  },
  map: {
    condition(data: unknown): boolean {
      return data instanceof Map
    },
    serialize(data: Map<unknown, unknown>): unknown[] {
      return Array.from(data.entries())
    },
  },
}

export interface OpenAPIJsonSerializerOptions {
  /**
   * Extend or override the built-in type handlers used during serialization.
   *
   * Each key is a unique type identifier (e.g. `"date"`, `"bigint"`) and maps to a handler
   * that defines how to detect and serialize values of that type.
   *
   * **Extending:** Add new keys to support custom types:
   * ```ts
   * handlers: {
   *   buffer: {
   *     condition: (v) => v instanceof Buffer,
   *     serialize: (v: Buffer) => v.toString('base64'),
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
  handlers?: Record<string, undefined | OpenAPIJsonSerializerHandler> | undefined

  /**
   * If true, properties with undefined values will be omitted during serialization.
   *
   * @default true
   */
  omitUndefinedProperties?: boolean | undefined
}

export class OpenAPIJsonSerializer {
  private readonly handlers: Exclude<OpenAPIJsonSerializerOptions['handlers'], undefined>
  private readonly omitUndefinedProperties: boolean

  constructor(options: OpenAPIJsonSerializerOptions = {}) {
    this.handlers = {
      ...DEFAULT_OPEN_API_JSON_SERIALIZER_HANDLERS,
      ...options.handlers,
    }

    this.omitUndefinedProperties = options.omitUndefinedProperties !== false
  }

  serialize(data: unknown): OpenAPIJsonSerialization {
    const [json, maps, blobs] = this.serializeValue(data, [], [], [])

    return { json, maps, blobs }
  }

  private serializeValue(data: unknown, segments: Segment[], maps: Segment[][], blobs: Blob[]): [unknown, Segment[][], Blob[]] {
    for (const key in this.handlers) {
      const handler = this.handlers[key]

      if (handler && handler.condition(data)) {
        const serialized = handler.serialize(data)

        if (handler.isTerminal) {
          return [serialized, maps, blobs]
        }

        const result = this.serializeValue(serialized, segments, maps, blobs)
        return result
      }
    }

    if (data instanceof Blob) {
      maps.push(segments)
      blobs.push(data)
      return [data, maps, blobs]
    }

    if (Array.isArray(data)) {
      const json = data.map((v, i) => {
        return this.serializeValue(v, [...segments, i], maps, blobs)[0]
      })

      return [json, maps, blobs]
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

        json[k] = this.serializeValue(v, [...segments, k], maps, blobs)[0]
      }

      return [json, maps, blobs]
    }

    return [data, maps, blobs]
  }

  deserialize(serialized: OpenAPIJsonSerialization): unknown {
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

    return ref.data
  }
}
