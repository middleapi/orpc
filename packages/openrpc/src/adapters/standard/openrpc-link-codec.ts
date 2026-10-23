import type { ClientContext, ClientOptions } from '@orpc/client'
import type { StandardLinkCodec, StandardLinkCodecDecodedResponse } from '@orpc/client/standard'
import type { Promisable, Public, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyResponse, StandardRequest, StandardUrl } from '@standard-server/core'
import type { JsonRpcRequest } from '../../json-rpc'
import { COMMON_ERROR_STATUS_MAP, createORPCErrorFromJson, MalformedResponseError, ResponseError } from '@orpc/client'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS } from '@orpc/server'
import { getOwn, isAsyncIteratorObject, isPlainObject, value } from '@orpc/shared'
import { JSON_RPC_VERSION } from '../../constants'
import { fromJsonRpcErrorCode, isJsonRpcResponse } from '../../json-rpc'

export interface OpenRPCLinkCodecOptions<T extends ClientContext> {
  /**
   * The JSON-RPC endpoint (without origin). Should match the handler's prefix.
   *
   * @default '/'
   */
  url?: Value<Promisable<StandardUrl>, [options: ClientOptions<T>, path: string[], input: unknown]> | undefined

  /**
   * Inject headers to the request.
   */
  headers?: Value<Promisable<StandardHeaders>, [options: ClientOptions<T>, path: string[], input: unknown]> | undefined

  /**
   * Serializes the input into JSON the same way OpenAPI requests are.
   *
   * @default new OpenAPIJsonSerializer()
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined
}

/**
 * Sends each call as a JSON-RPC 2.0 request whose `method` is the procedure path joined by `.`,
 * and restores `ORPCError`s, including their `defined` flag, from the responses of oRPC servers.
 */
export class OpenRPCLinkCodec<T extends ClientContext> implements StandardLinkCodec<T> {
  private readonly url: Exclude<OpenRPCLinkCodecOptions<T>['url'], undefined>
  private readonly headers: Exclude<OpenRPCLinkCodecOptions<T>['headers'], undefined>
  private readonly serializer: Exclude<OpenRPCLinkCodecOptions<T>['serializer'], undefined>

  /**
   * The request id of each call. `StandardLink` passes the same `options` object to `encodeInput` and `decodeResponse`.
   */
  private readonly ids = new WeakMap<ClientOptions<T>, number>()
  private lastId = 0

  constructor(options: OpenRPCLinkCodecOptions<T> = {}) {
    this.url = options.url ?? '/'
    this.headers = options.headers ?? {}
    this.serializer = options.serializer ?? new OpenAPIJsonSerializer()
  }

  async encodeInput(input: unknown, path: string[], options: ClientOptions<T>): Promise<StandardRequest> {
    const serialized = input === undefined ? undefined : this.serializer.serializeJson(input)

    if (input instanceof ReadableStream || isAsyncIteratorObject(input) || serialized?.blobs?.length) {
      throw new TypeError(`[OpenRPCLink] JSON-RPC cannot send streams or binary data in call to procedure (${path.join('.')}).`)
    }

    const id = ++this.lastId
    this.ids.set(options, id)

    const body: JsonRpcRequest = { jsonrpc: JSON_RPC_VERSION, id, method: path.join('.') }

    if (serialized !== undefined) {
      // objects are sent by-name, anything else by-position
      body.params = isPlainObject(serialized.json) ? serialized.json : [serialized.json]
    }

    return {
      method: 'POST',
      url: await value(this.url, options, path, input),
      headers: await value(this.headers, options, path, input),
      body,
      signal: options.signal,
    }
  }

  async decodeResponse(response: StandardLazyResponse, _path: string[], options: ClientOptions<T>): Promise<StandardLinkCodecDecodedResponse> {
    let body: unknown

    try {
      body = await response.resolveBody('json')
    }
    catch (cause) {
      if (options.signal?.aborted) {
        throw cause
      }

      throw new MalformedResponseError({ response: { status: response.status, headers: response.headers, body: undefined }, cause })
    }

    const snapshot = { status: response.status, headers: response.headers, body }

    // an error the server could not relate to a request (such as a parse error) has a `null` id
    if (!isJsonRpcResponse(body) || (body.id !== this.ids.get(options) && !('error' in body && body.id === null))) {
      throw new MalformedResponseError({ message: 'Invalid JSON-RPC response.', response: snapshot })
    }

    if (!('error' in body)) {
      return { kind: 'output', output: body.result }
    }

    const { code, message, data } = body.error
    // errors of oRPC servers carry their ORPCError in `data`
    const orpc = isPlainObject(data) && typeof data.code === 'string' && typeof data.defined === 'boolean' ? data : undefined
    const orpcCode = orpc ? orpc.code as string : fromJsonRpcErrorCode(code)

    const cause = new ResponseError({
      message: `Received JSON-RPC error ${code}.`,
      // JSON-RPC errors usually come with 200, so give status-based plugins (such as retry) the status of the code
      response: { ...snapshot, status: response.status >= 400 ? response.status : getOwn(COMMON_ERROR_STATUS_MAP, orpcCode) ?? DEFAULT_ERROR_STATUS },
    })

    return {
      kind: 'error',
      error: createORPCErrorFromJson({ code: orpcCode, defined: orpc?.defined === true, message, data: orpc ? orpc.data : data }, { cause }),
    }
  }
}
