import type { AnyORPCError, ClientContext, ClientOptions } from '@orpc/client'
import type { StandardLinkCodec, StandardLinkCodecDecodedResponse } from '@orpc/client/standard'
import type { AnyProcedureContract, RouterContract } from '@orpc/contract'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders, StandardLazyResponse, StandardRequest, StandardResponse, StandardUrl } from '@standardserver/core'
import type { OpenAPIMeta } from '../../meta'
import { createORPCErrorFromJson, isORPCErrorJson, ORPCError } from '@orpc/client'
import { getRouterContract, ProcedureContract } from '@orpc/contract'
import { unlazy } from '@orpc/server'
import { isTypescriptObject, mergeHttpPath, pathToHttpPath, stringifyJSON, value } from '@orpc/shared'
import { isStandardHeaders, mergeStandardHeaders, parseStandardUrl } from '@standardserver/core'
import { toStandardHeaders } from '@standardserver/fetch'
import {
  DEFAULT_OPENAPI_INPUT_STRUCTURE,
  DEFAULT_OPENAPI_METHOD,
  DEFAULT_OPENAPI_OUTPUT_STRUCTURE,
} from '../../constants'
import { getOpenAPIMeta } from '../../meta'
import { OpenAPISerializer } from '../../openapi-serializer'
import { getDynamicPathParams } from '../../utils'

export class OpenAPILinkCodecError extends TypeError {}

export interface OpenAPILinkCodecOptions<T extends ClientContext> {
  /**
   * Base URL for all requests, without origin. Should match the OpenAPI handler mount path.
   *
   * @example '/api'
   * @default '/'
   */
  url?: Value<Promisable<StandardUrl>, [options: ClientOptions<T>, path: string[], input: unknown]>

  /**
   * Inject headers into the request.
   */
  headers?: Value<Promisable<StandardHeaders | Headers>, [options: ClientOptions<T>, path: string[], input: unknown]>

  /**
   * Override the default OpenAPI serializer.
   */
  serializer?: Pick<OpenAPISerializer, keyof OpenAPISerializer>

  /**
   * Customize how an error response body is converted into an ORPC error.
   * Return `null` or `undefined` to fall back to the default decoding behavior.
   */
  customErrorResponseBodyDecoder?: (
    deserializedBody: unknown,
    response: StandardLazyResponse,
  ) => AnyORPCError | null | undefined
}

const END_SLASH_REGEX = /\/$/

export class OpenAPILinkCodec<T extends ClientContext> implements StandardLinkCodec<T> {
  private readonly baseUrl: Exclude<OpenAPILinkCodecOptions<T>['url'], undefined>
  private readonly headers: Exclude<OpenAPILinkCodecOptions<T>['headers'], undefined>
  private readonly serializer: Exclude<OpenAPILinkCodecOptions<T>['serializer'], undefined>
  private readonly customErrorResponseBodyDecoder: OpenAPILinkCodecOptions<T>['customErrorResponseBodyDecoder']

  constructor(
    private readonly router: RouterContract,
    options: OpenAPILinkCodecOptions<T> = {},
  ) {
    this.baseUrl = options.url ?? '/'
    this.headers = options.headers ?? {}
    this.serializer = options.serializer ?? new OpenAPISerializer()
    this.customErrorResponseBodyDecoder = options.customErrorResponseBodyDecoder
  }

  async encodeInput(input: unknown, path: string[], options: ClientOptions<T>): Promise<StandardRequest> {
    let headers = toResolvedStandardHeaders(await value(this.headers, options, path, input))
    if (options.lastEventId !== undefined) {
      headers = mergeStandardHeaders(headers, { 'last-event-id': options.lastEventId })
    }

    const baseUrl = await value(this.baseUrl, options, path, input)
    const procedure = await this.resolveProcedure(path)
    const meta = getOpenAPIMeta(procedure)

    const method = meta?.method ?? DEFAULT_OPENAPI_METHOD
    const inputStructure = meta?.inputStructure ?? DEFAULT_OPENAPI_INPUT_STRUCTURE
    let pathname = meta?.path ?? pathToHttpPath(path)
    if (meta?.prefix) {
      pathname = mergeHttpPath(meta.prefix, pathname)
    }

    const [basePathname, baseSearch, baseHash] = parseStandardUrl(baseUrl)
    const dynamicParams = getDynamicPathParams(pathname)

    if (inputStructure === 'compact') {
      let data = input

      if (dynamicParams?.length) {
        if (!isTypescriptObject(input)) {
          throw new OpenAPILinkCodecError(
            `Input must be an object with "compact" input structure when the path has dynamic params (${dynamicParams.map(p => p.parameterName).join(', ')}) in call to procedure (${path.join('.')}).`,
          )
        }

        const remaining = { ...input }

        for (let i = dynamicParams.length - 1; i >= 0; i--) {
          const param = dynamicParams[i]!
          const encoded = await this.encodePathParam(input[param.parameterName], param, meta?.paramsStyles?.[param.parameterName], path)
          pathname = `${pathname.slice(0, param.startIndex)}${encoded}${pathname.slice(param.startIndex + param.segment.length)}` as `/${string}`
          delete remaining[param.parameterName]
        }

        data = Object.keys(remaining).length > 0 ? remaining : undefined
      }

      pathname = `${basePathname.replace(END_SLASH_REGEX, '')}${pathname}` as `/${string}`

      if (method === 'GET') {
        const queryString = await this.serializeQueryString(data, meta?.queryStyles)
        const search = combineSearch(baseSearch, queryString)
        const url = `${pathname}${search ?? ''}${baseHash ?? ''}` as StandardUrl

        return {
          body: undefined,
          method,
          headers,
          url,
          signal: options.signal,
        }
      }

      const url = `${pathname}${baseSearch ?? ''}${baseHash ?? ''}` as StandardUrl

      return {
        url,
        method,
        headers,
        body: await this.serializer.serialize(data),
        signal: options.signal,
      }
    }

    if (!isValidDetailedInput(input)) {
      throw new OpenAPILinkCodecError(`
        Invalid "detailed" input structure in call to procedure (${path.join('.')}):
        • Expected an object or undefined with optional properties:
          - params (object, required when the path has dynamic params)
          - query (object)
          - headers (Record<string, string | string[] | undefined>)
          - body (any)

        Actual value:
          ${stringifyJSON(input)}
      `)
    }

    if (dynamicParams?.length) {
      if (!input?.params) {
        throw new OpenAPILinkCodecError(
          `The "params" property is required for "detailed" input when the path has dynamic params (${dynamicParams.map(p => p.parameterName).join(', ')}) in call to procedure (${path.join('.')}).`,
        )
      }

      for (let i = dynamicParams.length - 1; i >= 0; i--) {
        const param = dynamicParams[i]!
        const val = input.params[param.parameterName]
        const encoded = await this.encodePathParam(val, param, meta?.paramsStyles?.[param.parameterName], path)
        pathname = `${pathname.slice(0, param.startIndex)}${encoded}${pathname.slice(param.startIndex + param.segment.length)}` as `/${string}`
      }
    }

    if (input?.headers) {
      headers = mergeStandardHeaders(headers, input.headers)
    }

    pathname = `${basePathname.replace(END_SLASH_REGEX, '')}${pathname}` as `/${string}`
    const queryString = await this.serializeQueryString(input?.query, meta?.queryStyles)
    const search = combineSearch(baseSearch, queryString)
    const url = `${pathname}${search ?? ''}${baseHash ?? ''}` as StandardUrl

    if (method === 'GET') {
      return {
        body: undefined,
        method,
        headers,
        url,
        signal: options.signal,
      }
    }

    return {
      url,
      method,
      headers,
      body: await this.serializer.serialize(input?.body),
      signal: options.signal,
    }
  }

  private async encodePathParam(
    val: unknown,
    param: { parameterName: string, allowsSlash: boolean, segment: string },
    style: Exclude<OpenAPIMeta['paramsStyles'], undefined>[string],
    path: string[],
  ): Promise<string> {
    let encoded: string | undefined

    if (style === 'comma-delimited-array' && Array.isArray(val)) {
      encoded = (await Promise.all(val
        .map(val => this.serializer.serialize(val))))
        .filter(val => val !== undefined && val !== null)
        .map(val => encodeURIComponent(String(val)))
        .join(',')
    }
    else if (style === 'comma-delimited-object' && isTypescriptObject(val)) {
      encoded = (await resolveEntries(Object.entries(val).map(([key, val]) => [key, this.serializer.serialize(val)])))
        .filter(([, val]) => val !== undefined && val !== null)
        .map(([key, val]) => `${encodeURIComponent(String(key))},${encodeURIComponent(String(val))}`)
        .join(',')
    }
    else {
      const serialized = await this.serializer.serialize(val)

      if (serialized !== undefined && serialized !== null) {
        if (param.allowsSlash) {
          encoded = String(serialized).split('/').map(encodeURIComponent).join('/')
        }
        else {
          encoded = encodeURIComponent(String(serialized))
        }
      }
    }

    if (!encoded) {
      throw new OpenAPILinkCodecError(`Path param "${param.parameterName}" cannot be empty in call to procedure (${path.join('.')}).`)
    }

    return encoded
  }

  private async serializeQueryString(data: unknown, queryStyles: OpenAPIMeta['queryStyles']): Promise<string | undefined> {
    if (!queryStyles || !isTypescriptObject(data)) {
      return toURLSearchParams(
        await this.serializer.serialize(data, { asFormData: true }) as FormData,
      ).toString()
    }

    const remaining = { ...data }
    let query = ''

    const entries = Object.entries(queryStyles)

    for (const entry of entries) {
      const [key, style] = entry

      if (style === undefined) {
        continue
      }

      const value = remaining[key]
      delete remaining[key]

      if (style === 'primitive') {
        const serialized = await this.serializer.serialize(value)
        if (serialized !== undefined && serialized !== null) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodeURLSearchParamComponent(String(serialized))}`
        }
      }

      else if (style === 'array' && Array.isArray(value)) {
        const encodedKey = encodeURLSearchParamComponent(key)

        for (const v of value) {
          const s = await this.serializer.serialize(v)
          if (s !== undefined && s !== null) {
            query += `&${encodedKey}=${encodeURLSearchParamComponent(String(s))}`
          }
        }
      }

      else if (style === 'json') {
        const serialized = await this.serializer.serialize(value)

        if (serialized !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodeURLSearchParamComponent(stringifyJSON(serialized))}`
        }
      }

      else if (style === 'comma-delimited-array' && Array.isArray(value)) {
        const encodedValue = encodeDelimitedArray(
          await Promise.all(value.map(v => this.serializer.serialize(v))),
          ',',
        )

        if (encodedValue !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodedValue}`
        }
      }

      else if (style === 'comma-delimited-object' && isTypescriptObject(value)) {
        const encodedValue = encodeDelimitedObject(
          (await resolveEntries(Object.entries(value).map(([key, val]) => [key, this.serializer.serialize(val)]))),
          ',',
        )

        if (encodedValue !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodedValue}`
        }
      }

      else if (style === 'pipe-delimited-array' && Array.isArray(value)) {
        const encodedValue = encodeDelimitedArray(
          await Promise.all(value.map(v => this.serializer.serialize(v))),
          '%7C' /* '/' */,
        )

        if (encodedValue !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodedValue}`
        }
      }

      else if (style === 'pipe-delimited-object' && isTypescriptObject(value)) {
        const encodedValue = encodeDelimitedObject(
          (await resolveEntries(Object.entries(value).map(([key, val]) => [key, this.serializer.serialize(val)]))),
          '%7C' /* '/' */,
        )

        if (encodedValue !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodedValue}`
        }
      }

      else if (style === 'space-delimited-array' && Array.isArray(value)) {
        const encodedValue = encodeDelimitedArray(
          await Promise.all(value.map(v => this.serializer.serialize(v))),
          '%20' /* ' ' */,
        )

        if (encodedValue !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodedValue}`
        }
      }

      else if (style === 'space-delimited-object' && isTypescriptObject(value)) {
        const encodedValue = encodeDelimitedObject(
          (await resolveEntries(Object.entries(value).map(([key, val]) => [key, this.serializer.serialize(val)]))),
          '%20' /* ' ' */,
        )

        if (encodedValue !== undefined) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodedValue}`
        }
      }

      else {
        const serialized = await this.serializer.serialize(value)
        if (serialized !== undefined && serialized !== null) {
          query += `&${encodeURLSearchParamComponent(key)}=${encodeURLSearchParamComponent(String(serialized))}`
        }
      }
    }

    const form = await this.serializer.serialize(remaining, { asFormData: true }) as FormData
    query = `${toURLSearchParams(form).toString()}${query}`

    if (query.startsWith('&')) {
      query = query.slice(1)
    }

    return query || undefined
  }

  async decodeResponse(
    response: StandardLazyResponse,
    path: string[],
    _options: ClientOptions<T>,
  ): Promise<StandardLinkCodecDecodedResponse> {
    const isOk = response.status < 400
    const procedure = await this.resolveProcedure(path)
    const meta = getOpenAPIMeta(procedure)

    const deserialized = await (async () => {
      let isBodyOk = false

      try {
        const body = await response.resolveBody(meta?.responseBodyHint)

        isBodyOk = true

        return this.serializer.deserialize(body)
      }
      catch (error) {
        if (!isBodyOk) {
          throw new Error('Cannot parse response body, please check the response body and content-type.', {
            cause: error,
          })
        }

        throw new Error('Invalid OpenAPI response format.', {
          cause: error,
        })
      }
    })()

    if (!isOk) {
      const customError = this.customErrorResponseBodyDecoder?.(deserialized, response)

      if (customError !== undefined && customError !== null) {
        return { kind: 'error', error: customError }
      }

      if (isORPCErrorJson(deserialized)) {
        return { kind: 'error', error: createORPCErrorFromJson(deserialized) }
      }

      return {
        kind: 'error',
        error: new ORPCError<'MALFORMED_ORPC_ERROR_RESPONSE', StandardResponse>('MALFORMED_ORPC_ERROR_RESPONSE', {
          data: { headers: response.headers, status: response.status, body: deserialized },
        }),
      }
    }

    const outputStructure = meta?.outputStructure ?? DEFAULT_OPENAPI_OUTPUT_STRUCTURE

    return outputStructure === 'compact'
      ? { kind: 'output', output: deserialized }
      : {
          kind: 'output',
          output: {
            status: response.status,
            headers: response.headers,
            body: deserialized,
          },
        }
  }

  private async resolveProcedure(path: string[]): Promise<AnyProcedureContract> {
    const { default: maybeProcedure } = await unlazy(getRouterContract(this.router, path))

    if (!(maybeProcedure instanceof ProcedureContract)) {
      throw new OpenAPILinkCodecError(`Expected a procedure or contract at path (${path.join('.')})`)
    }

    return maybeProcedure
  }
}

function combineSearch(baseSearch: `?${string}` | undefined, additionalSearch: string | undefined): `?${string}` | undefined {
  if (!baseSearch && !additionalSearch) {
    return undefined
  }

  if (!additionalSearch) {
    return baseSearch
  }

  if (!baseSearch) {
    return `?${additionalSearch}` as `?${string}`
  }

  return `${baseSearch}&${additionalSearch}` as `?${string}`
}

function toResolvedStandardHeaders(headers: Headers | StandardHeaders): StandardHeaders {
  /**
   * Headers class might not be available in some environments,
   * so we check for the existence of `forEach` and `get`
   * methods to determine if it's a Headers instance.
   */
  if (typeof headers.forEach === 'function') {
    return toStandardHeaders(headers as Headers)
  }

  return headers as StandardHeaders
}

function isValidDetailedInput(
  input: unknown,
): input is undefined | { params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: StandardHeaders, body?: unknown } {
  if (!isTypescriptObject(input)) {
    return input === undefined
  }

  if (input.params !== undefined && !isTypescriptObject(input.params)) {
    return false
  }

  if (input.query !== undefined && !isTypescriptObject(input.query)) {
    return false
  }

  if (input.headers !== undefined && !isStandardHeaders(input.headers)) {
    return false
  }

  return true
}

/**
 * Encode a query parameter value using URLSearchParams semantics.
 * Prefer this over encodeURIComponent for query-string values.
 */
function encodeURLSearchParamComponent(value: string): string {
  return new URLSearchParams({ '': value }).toString().slice(1)
}

function toURLSearchParams(form: FormData): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of form) {
    params.append(key, String(value))
  }
  return params
}

function encodeDelimitedArray(serializedValues: unknown[], encodedDelimiter: string): string | undefined {
  const strings = serializedValues.filter(v => v !== null && v !== undefined).map(String)

  if (!strings.length) {
    return undefined
  }

  return strings.map(encodeURLSearchParamComponent).join(encodedDelimiter)
}

function encodeDelimitedObject(entries: [string, unknown][], encodedDelimiter: string): string | undefined {
  const strings = entries
    .filter(([v]) => v !== null && v !== undefined)
    .map(([k, v]) => [k, String(v)]) as [string, string][]

  if (!strings.length) {
    return undefined
  }

  return strings
    .map(
      ([key, value]) => `${encodeURLSearchParamComponent(key)}${encodedDelimiter}${encodeURLSearchParamComponent(value)}`,
    )
    .join(encodedDelimiter)
}

async function resolveEntries(entries: [PropertyKey, Promise<unknown>][]): Promise<[string, unknown][]> {
  return (await Promise.all(entries.map(([, val]) => val))).map((val, i) => {
    const entry = entries[i]
    if (!entry) {
      return null
    }
    return [entry[0], val] as const
  }).filter(entry => entry !== null) as [string, unknown][]
}
