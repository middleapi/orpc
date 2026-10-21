import type { StandardBracketNotationSerializer } from './bracket-notation'
import type { StandardOpenAPIJsonSerializer } from './openapi-json-serializer'
import { createORPCErrorFromJson, isORPCErrorJson, mapEventIterator, toORPCError } from '@orpc/client'
import { isAsyncIteratorObject } from '@orpc/shared'
import { ErrorEvent } from '@orpc/standard-server'
import { fillORPCErrorJsonStatus } from './utils'

export interface StandardOpenAPISerializeOptions {
  outputFormat?: 'plain' | 'URLSearchParams'
}

export class StandardOpenAPISerializer {
  constructor(
    private readonly jsonSerializer: StandardOpenAPIJsonSerializer,
    private readonly bracketNotation: StandardBracketNotationSerializer,
  ) {
  }

  serialize(data: unknown, options: StandardOpenAPISerializeOptions = {}): unknown {
    if (isAsyncIteratorObject(data) && !options.outputFormat) {
      return mapEventIterator(data, {
        value: async value => this.#serialize(value, { outputFormat: 'plain' }),
        error: async (e) => {
          return new ErrorEvent({
            data: this.#serialize(toORPCError(e).toJSON(), { outputFormat: 'plain' }),
            cause: e,
          })
        },
      })
    }

    return this.#serialize(data, options)
  }

  #serialize(data: unknown, options: StandardOpenAPISerializeOptions): unknown {
    const [json, hasBlob] = this.jsonSerializer.serialize(data)

    if (options.outputFormat === 'plain') {
      return json
    }

    if (options.outputFormat === 'URLSearchParams') {
      const params = new URLSearchParams()

      for (const [path, value] of this.bracketNotation.serialize(json)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          params.append(path, value.toString())
        }
      }

      return params
    }

    if (json instanceof Blob || json === undefined || !hasBlob) {
      return json
    }

    const form = new FormData()

    for (const [path, value] of this.bracketNotation.serialize(json)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        form.append(path, value.toString())
      }
      else if (value instanceof Blob) {
        form.append(path, value)
      }
    }

    return form
  }

  deserialize(data: unknown): unknown {
    if (data instanceof URLSearchParams || data instanceof FormData) {
      return this.bracketNotation.deserialize(Array.from(data.entries()))
    }

    if (isAsyncIteratorObject(data)) {
      return mapEventIterator(data, {
        value: async value => value,
        error: async (e) => {
          if (e instanceof ErrorEvent) {
            const errorJson = fillORPCErrorJsonStatus(e.data)

            if (isORPCErrorJson(errorJson)) {
              return createORPCErrorFromJson(errorJson, { cause: e })
            }
          }

          return e
        },
      })
    }

    return data
  }
}
