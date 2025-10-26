import type { ORPCError } from '@orpc/client'
import type { StandardOpenAPISerializer } from '@orpc/openapi-client/standard'
import type { AnyProcedure } from '@orpc/server'
import type { StandardCodec, StandardParams } from '@orpc/server/standard'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@orpc/standard-server'
import { isORPCErrorStatus } from '@orpc/client'
import { fallbackContractConfig } from '@orpc/contract'
import { isObject, stringifyJSON } from '@orpc/shared'

export interface StandardOpenAPICodecOptions {
  /**
   * Customize how an ORPC error is encoded into a response body.
   * Use this if your API needs a different error output structure.
   *
   * @remarks
   * - Return `null | undefined` to fallback to default behavior
   *
   * @default ((e) => e.toJSON())
   */
  customErrorResponseBodyEncoder?: (error: ORPCError<any, any>) => unknown
}

export class StandardOpenAPICodec implements StandardCodec {
  private readonly customErrorResponseBodyEncoder: StandardOpenAPICodecOptions['customErrorResponseBodyEncoder']

  constructor(
    private readonly serializer: StandardOpenAPISerializer,
    options: StandardOpenAPICodecOptions = {},
  ) {
    this.customErrorResponseBodyEncoder = options.customErrorResponseBodyEncoder
  }

  async decode(request: StandardLazyRequest, params: StandardParams | undefined, procedure: AnyProcedure): Promise<unknown> {
    const inputStructure = fallbackContractConfig('defaultInputStructure', procedure['~orpc'].route.inputStructure)

    if (inputStructure === 'compact') {
      const data = request.method === 'GET'
        ? this.serializer.deserialize(request.url.searchParams)
        : this.serializer.deserialize(await request.body())

      if (data === undefined) {
        return params
      }

      if (isObject(data)) {
        return {
          ...params,
          ...data,
        }
      }

      return data
    }

    const deserializeSearchParams = () => {
      return this.serializer.deserialize(request.url.searchParams)
    }

    return {
      params,
      get query() {
        const value = deserializeSearchParams()
        Object.defineProperty(this, 'query', { value, writable: true })
        return value
      },
      set query(value) {
        Object.defineProperty(this, 'query', { value, writable: true })
      },
      headers: request.headers,
      body: this.serializer.deserialize(await request.body()),
    }
  }

  encode(output: unknown, procedure: AnyProcedure): StandardResponse {
    const successStatus = fallbackContractConfig('defaultSuccessStatus', procedure['~orpc'].route.successStatus)
    const outputStructure = fallbackContractConfig('defaultOutputStructure', procedure['~orpc'].route.outputStructure)

    if (outputStructure === 'compact') {
      return {
        status: successStatus,
        headers: {},
        body: this.serializer.serialize(output),
      }
    }

    if (!this.#isDetailedOutput(output)) {
      throw new Error(`
        Invalid "detailed" output structure:
        • Expected an object with optional properties:
          - status (number 200-399)
          - headers (Record<string, string | string[]>)
          - body (any)
        • No extra keys allowed.

        Actual value:
          ${stringifyJSON(output)}
      `)
    }

    return {
      status: output.status ?? successStatus,
      headers: output.headers ?? {},
      body: this.serializer.serialize(output.body),
    }
  }

  encodeError(error: ORPCError<any, any>): StandardResponse {
    const body = this.customErrorResponseBodyEncoder?.(error) ?? error.toJSON()

    return {
      status: error.status,
      headers: {},
      body: this.serializer.serialize(body, { outputFormat: 'plain' }),
    }
  }

  #isDetailedOutput(output: unknown): output is { status?: number, body?: unknown, headers?: StandardHeaders } {
    if (!isObject(output)) {
      return false
    }

    if (output.headers && !isObject(output.headers)) {
      return false
    }

    if (output.status !== undefined && (typeof output.status !== 'number' || !Number.isInteger(output.status) || isORPCErrorStatus(output.status))) {
      return false
    }

    return true
  }
}
