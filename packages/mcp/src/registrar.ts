import type { CallToolResult, ContentBlock, McpServer, RegisteredTool, ServerContext, StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server'
import type { AnyORPCError } from '@orpc/client'
import type { AnyProcedureContract } from '@orpc/contract'
import type { JsonSchemaConverter } from '@orpc/json-schema'
import type { OpenAPIMeta } from '@orpc/openapi'
import type { AnyProcedure, AnyRouter, Context, InferRouterInitialContext, StandardHeaders, StandardLazyRequest, StandardResponse } from '@orpc/server'
import type { StandardHandlerCodec, StandardHandlerCodecResolvedProcedure, StandardHandlerOptions } from '@orpc/server/standard'
import type { MaybeOptionalOptions, Promisable, Public, Value } from '@orpc/shared'
import type { McpToolMeta } from './meta'
import type { ToolInputJsonSchema } from './utils'
import { BAGGAGE_META_KEY, TRACEPARENT_META_KEY, TRACESTATE_META_KEY } from '@modelcontextprotocol/server'
import { COMMON_ERROR_STATUS_MAP, ORPCError, toORPCError, wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import { DelegatingJsonSchemaConverter, StandardJsonSchemaConverter } from '@orpc/json-schema'
import { getOpenAPIMeta, OpenAPIJsonSerializer } from '@orpc/openapi'
import { DEFAULT_ERROR_STATUS, DEFAULT_SUCCESS_STATUS, ErrorEvent, resolveContractProcedure, walkProcedureContractsAsync } from '@orpc/server'
import { StandardHandler } from '@orpc/server/standard'
import { encodeBase64, getOwn, isAsyncIteratorObject, loadBytes, pathToHttpPath, resolveMaybeOptionalOptions, safeEncodeURIComponent, stringifyJSON, throwIfAborted, toArray, value } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standard-server/core'
import { getMcpToolMeta } from './meta'
import { resolveToolInput, resolveToolInputJsonSchema, resolveToolOutputJsonSchema, toPassthroughStandardSchema } from './utils'

/**
 * Options for {@link McpRegistrar}. Tool calls run through a standard handler,
 * so its `plugins`, `interceptors`, `clientInterceptors`, and `routingInterceptors` apply to every tool call.
 *
 * @see {@link https://orpc.dev/docs/integrations/mcp#plugins-and-interceptors | MCP Integration - Plugins and Interceptors}
 */
export interface McpRegistrarOptions<TInitialContext extends Context> extends StandardHandlerOptions<TInitialContext> {
  /**
   * Converters that turn input and output schemas into the JSON Schemas tools advertise.
   * Schemas implementing [Standard JSON Schema](https://standardschema.dev/json-schema),
   * such as Zod v4.2+, are converted without one.
   *
   * @see {@link https://orpc.dev/docs/integrations/mcp#json-schema-converters | MCP Integration - JSON Schema Converters}
   */
  converters?: JsonSchemaConverter[] | undefined

  /**
   * Serializes outputs and error data into JSON, converting types such as `Date`, `BigInt`, and `Set`
   * the same way OpenAPI responses do. Pass the `OpenAPISerializer` of your OpenAPI handler to share its custom types.
   *
   * @default new OpenAPIJsonSerializer()
   */
  serializer?: Public<OpenAPIJsonSerializer> | undefined

  /**
   * Filter procedures. Return `false` to skip registering a procedure as a tool.
   *
   * @default true
   */
  filter?: Value<boolean, [contract: AnyProcedureContract | AnyProcedure, path: string[]]> | undefined
}

/**
 * Options for {@link McpRegistrar.register}.
 *
 * `context` is the initial context of each tool call: a value, or a function receiving the MCP request context,
 * which exposes the HTTP request and verified auth info when served over HTTP.
 * It is optional only when an empty object satisfies the initial context.
 */
export type McpRegistrarRegisterOptions<TInitialContext extends Context>
  = object extends TInitialContext
    ? { context?: Value<Promisable<TInitialContext>, [ctx: ServerContext]> | undefined }
    : { context: Value<Promisable<TInitialContext>, [ctx: ServerContext]> }

/**
 * The tools {@link McpRegistrar.register} registered, by name.
 */
export interface McpRegistered {
  tools: Record<string, RegisteredTool>
}

interface McpRoute {
  path: string[]
  contract: AnyProcedureContract
  procedure: AnyProcedure
  inputJsonSchema: ToolInputJsonSchema
}

interface McpToolDefinition {
  name: string
  path: string[]
  config: {
    title: string | undefined
    description: string | undefined
    inputSchema: StandardSchemaWithJSON
    outputSchema: StandardSchemaWithJSON | undefined
    annotations: ToolAnnotations | undefined
    icons: McpToolMeta['icons']
    _meta: Record<string, unknown> | undefined
  }
  call: (args: unknown, ctx: ServerContext) => Promise<CallToolResult>
}

const TRACE_META_KEYS = [TRACEPARENT_META_KEY, TRACESTATE_META_KEY, BAGGAGE_META_KEY]

const METHOD_ANNOTATIONS: Partial<Record<NonNullable<OpenAPIMeta['method']>, ToolAnnotations>> = {
  GET: { readOnlyHint: true },
  HEAD: { readOnlyHint: true },
  QUERY: { readOnlyHint: true },
  PUT: { idempotentHint: true },
  DELETE: { idempotentHint: true },
}

/**
 * Exposes every procedure in a router as a [tool](https://modelcontextprotocol.io/specification/latest/server/tools) on MCP servers.
 * Tool definitions derive from `mcp.tool` meta, falling back to [OpenAPI meta](https://orpc.dev/docs/openapi/specification#metadata).
 *
 * Calling a tool calls its procedure through a standard handler, so plugins and interceptors apply:
 * oRPC validates input and output, runs middlewares, and reports errors as tool execution errors the model can read.
 *
 * @example
 * ```ts
 * import { McpServer } from '@modelcontextprotocol/server'
 * import { McpRegistrar } from '@orpc/experimental-mcp'
 *
 * const registrar = new McpRegistrar(router)
 *
 * const server = new McpServer({ name: 'planets', version: '1.0.0' })
 * await registrar.register(server, {
 *   context: {}, // provide initial context if needed
 * })
 * ```
 *
 * @see {@link https://orpc.dev/docs/integrations/mcp | MCP Integration}
 */
export class McpRegistrar<T extends AnyRouter> {
  private readonly converter: DelegatingJsonSchemaConverter
  private readonly matcher: McpMatcher
  private readonly codec: McpHandlerCodec
  private readonly handler: StandardHandler<any>

  constructor(
    router: T,
    { converters, serializer, filter, ...options }: McpRegistrarOptions<InferRouterInitialContext<T>> = {},
  ) {
    this.converter = new DelegatingJsonSchemaConverter([...toArray(converters), new StandardJsonSchemaConverter()])
    this.matcher = new McpMatcher(router, this.converter, filter)
    this.codec = new McpHandlerCodec(this.matcher, serializer ?? new OpenAPIJsonSerializer())
    this.handler = new StandardHandler(this.codec, options)
  }

  /**
   * Registers every tool on an MCP server, and returns them by name.
   * Tool calls on this server resolve their initial context from the `context` option.
   *
   * The router is loaded on the first call and reused afterward, such as when registering on a fresh server per request.
   *
   * @see {@link https://orpc.dev/docs/integrations/mcp#context | MCP Integration - Context}
   */
  async register(
    server: McpServer,
    ...rest: MaybeOptionalOptions<McpRegistrarRegisterOptions<InferRouterInitialContext<T>>>
  ): Promise<McpRegistered> {
    const { context } = resolveMaybeOptionalOptions(rest) as McpRegistrarRegisterOptions<Context>
    const tools = new Map<string, McpToolDefinition>()

    // every tool is validated before anything is registered
    for (const [url, route] of await this.matcher.resolveRoutes()) {
      const tool = this.createToolDefinition(url, route, context)
      const existing = tools.get(tool.name)

      if (existing !== undefined) {
        throw new TypeError(
          `[MCP] Procedures at "${existing.path.join('.')}" and "${route.path.join('.')}" share the tool name "${tool.name}". `
          + `Set a unique one with mcp.tool({ name }), or exclude one with the filter option.`,
        )
      }

      tools.set(tool.name, tool)
    }

    const registered: McpRegistered = { tools: {} }

    for (const { name, config, call } of tools.values()) {
      registered.tools[name] = server.registerTool(name, config, call)
    }

    return registered
  }

  private createToolDefinition(url: `/${string}`, { path, contract, inputJsonSchema }: McpRoute, context: McpRegistrarRegisterOptions<Context>['context']): McpToolDefinition {
    const mcpMeta = getMcpToolMeta(contract)
    const openapiMeta = getOpenAPIMeta(contract)
    const name = mcpMeta?.name ?? openapiMeta?.operationId ?? path.join('_')

    if (name === '') {
      throw new TypeError(`[MCP] Procedure at "${path.join('.') || '(root)'}" has no name. Set one with mcp.tool({ name }).`)
    }

    const outputJsonSchema = resolveToolOutputJsonSchema(this.converter, toArray(contract['~orpc'].outputSchemas))
    const inferredAnnotations = openapiMeta?.method && METHOD_ANNOTATIONS[openapiMeta.method]

    return {
      name,
      path,
      config: {
        title: mcpMeta?.title ?? openapiMeta?.summary,
        description: mcpMeta?.description ?? openapiMeta?.description ?? openapiMeta?.summary,
        inputSchema: toPassthroughStandardSchema(inputJsonSchema.jsonSchema),
        outputSchema: outputJsonSchema && toPassthroughStandardSchema(outputJsonSchema),
        annotations: inferredAnnotations || mcpMeta?.annotations
          ? { ...inferredAnnotations, ...mcpMeta?.annotations }
          : undefined,
        icons: mcpMeta?.icons,
        _meta: mcpMeta?._meta,
      },
      call: async (args, ctx) => {
        try {
          const { matched, response } = await this.handler.handle(
            // tool calls have no HTTP request of their own, so only the trace context is carried over
            { method: 'POST', url, headers: toTraceHeaders(ctx.mcpReq._meta), signal: ctx.mcpReq.signal, resolveBody: () => Promise.resolve(args) },
            { context: async () => await value(context, ctx) ?? {} },
          )

          if (!matched) {
            throw new ORPCError('NOT_FOUND')
          }

          if (response.status >= 400) {
            return toErrorCallToolResult(response.body)
          }

          if (isAsyncIteratorObject(response.body)) {
            return await toCallToolResult(await consumeIteratorBody(response.body, ctx))
          }

          return await toCallToolResult(response.body, flattenStandardHeader(response.headers['content-type']))
        }
        catch (e) {
          // a tool execution error the model can read, rather than a protocol error
          return toErrorCallToolResult(e instanceof ErrorEvent ? e.data : this.codec.encodeError(toORPCError(e)).body)
        }
      },
    }
  }
}

/**
 * Routes tool calls to procedures by their HTTP path.
 * Lazy routers and contract-first implementations are loaded on first use and reused afterward.
 */
class McpMatcher {
  private routes: Promise<Map<`/${string}`, McpRoute>> | undefined

  constructor(
    private readonly router: AnyRouter,
    private readonly converter: Pick<JsonSchemaConverter, 'convert'>,
    private readonly filter: McpRegistrarOptions<any>['filter'],
  ) {}

  resolveRoutes(): Promise<Map<`/${string}`, McpRoute>> {
    return this.routes ??= this.loadRoutes().catch((error) => {
      // retry on the next call, such as when a lazy router failed to load
      this.routes = undefined
      throw error
    })
  }

  async match(pathname: `/${string}`): Promise<McpRoute | undefined> {
    return (await this.resolveRoutes()).get(pathname)
  }

  private async loadRoutes(): Promise<Map<`/${string}`, McpRoute>> {
    const routes = new Map<`/${string}`, McpRoute>()

    await walkProcedureContractsAsync(this.router, async (contract, path) => {
      if (value(this.filter, contract, path) === false) {
        return
      }

      routes.set(pathToHttpPath(path), {
        path,
        contract,
        procedure: await resolveContractProcedure(this.router, contract, path),
        inputJsonSchema: resolveToolInputJsonSchema(this.converter, toArray(contract['~orpc'].inputSchemas)),
      })
    })

    return routes
  }
}

/**
 * Decodes tool arguments from the request body, and encodes outputs and errors into JSON bodies.
 */
class McpHandlerCodec implements StandardHandlerCodec<Context> {
  constructor(
    private readonly matcher: McpMatcher,
    private readonly serializer: Public<OpenAPIJsonSerializer>,
  ) {}

  async resolveProcedure(request: StandardLazyRequest): Promise<StandardHandlerCodecResolvedProcedure | undefined> {
    const [pathname] = parseStandardUrl(request.url)
    const route = await this.matcher.match(pathname)

    if (route === undefined) {
      return undefined
    }

    return {
      path: route.path,
      procedure: route.procedure,
      decodeInput: async () => resolveToolInput(await request.resolveBody(), route.inputJsonSchema),
    }
  }

  encodeOutput(output: unknown): StandardResponse {
    if (isAsyncIteratorObject(output)) {
      return {
        status: DEFAULT_SUCCESS_STATUS,
        headers: {},
        body: wrapAsyncIteratorPreservingEventMeta(output, {
          mapResult: result => ({ done: result.done, value: this.serialize(result.value) }),
          mapError: e => new ErrorEvent(this.serialize(toORPCError(e).toJSON()), { cause: e }),
        }),
      }
    }

    return { status: DEFAULT_SUCCESS_STATUS, headers: {}, body: this.serialize(output) }
  }

  encodeError(error: AnyORPCError): StandardResponse {
    return {
      status: getOwn(COMMON_ERROR_STATUS_MAP, error.code) ?? DEFAULT_ERROR_STATUS,
      headers: {},
      body: this.serialize(error.toJSON()),
    }
  }

  private serialize(data: unknown): unknown {
    // kept as is, like the body of an OpenAPI response, so it becomes an empty tool result rather than null
    // (blobs and streams are returned as is by the serializer)
    return data === undefined ? undefined : this.serializer.serializeJson(data).json
  }
}

/**
 * Tools return a single result, so the last event becomes the result,
 * and every event is reported as progress when the client asks for it.
 */
async function consumeIteratorBody(iterator: AsyncIterable<unknown>, ctx: ServerContext): Promise<unknown> {
  const progressToken = ctx.mcpReq._meta?.progressToken

  let last: unknown
  let progress = 0

  for await (const event of iterator) {
    throwIfAborted(ctx.mcpReq.signal)

    last = event

    if (progressToken !== undefined) {
      await ctx.mcpReq.notify({
        method: 'notifications/progress',
        params: { progressToken, progress: ++progress, message: toText(event) },
      })
    }
  }

  return last
}

function toTraceHeaders(meta: Record<string, unknown> | undefined): StandardHeaders {
  const headers: StandardHeaders = {}

  for (const key of TRACE_META_KEYS) {
    if (typeof meta?.[key] === 'string') {
      headers[key] = meta[key]
    }
  }

  return headers
}

function toText(json: unknown): string | undefined {
  if (typeof json === 'string') {
    return json
  }

  if (json instanceof Blob || json instanceof ReadableStream) {
    return undefined
  }

  return stringifyJSON(json)
}

/**
 * A stream has no type of its own, so it takes the content type of the response,
 * such as one a procedure sets with the Response Headers Plugin.
 */
async function toCallToolResult(serialized: unknown, contentType?: string): Promise<CallToolResult> {
  if (serialized instanceof ReadableStream) {
    serialized = await new Response(serialized, { headers: contentType === undefined ? {} : { 'content-type': contentType } }).blob()
  }

  if (serialized instanceof Blob) {
    return { content: [await toBinaryContent(serialized)] }
  }

  if (serialized === undefined) {
    return { content: [] }
  }

  return {
    content: [{ type: 'text', text: toText(serialized)! }],
    structuredContent: serialized,
  }
}

function toErrorCallToolResult(json: unknown): CallToolResult {
  return { content: [{ type: 'text', text: stringifyJSON(json)! }], isError: true }
}

async function toBinaryContent(blob: Blob): Promise<ContentBlock> {
  const data = encodeBase64(await loadBytes(blob))
  const mimeType = blob.type || 'application/octet-stream'
  const name = blob instanceof File ? blob.name : undefined

  if (mimeType.startsWith('image/')) {
    return { type: 'image', data, mimeType }
  }

  if (mimeType.startsWith('audio/')) {
    return { type: 'audio', data, mimeType }
  }

  return {
    type: 'resource',
    resource: { uri: `file:///${safeEncodeURIComponent(name || 'blob')}`, mimeType, blob: data },
  }
}
