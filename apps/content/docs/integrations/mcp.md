# MCP Integration

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) is an open standard for connecting AI applications to external tools and data. This integration exposes your oRPC router as an MCP server, so the **same** procedures you already serve over RPC and OpenAPI become MCP **tools**, **resources**, and **prompts** — usable by clients like Claude, ChatGPT, and IDEs, with the same types, validation, and middleware.

::: warning
This guide assumes you are familiar with [MCP](https://modelcontextprotocol.io). The integration targets protocol revision `2025-11-25`.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/experimental-mcp@beta
```

```sh [yarn]
yarn add @orpc/experimental-mcp@beta
```

```sh [pnpm]
pnpm add @orpc/experimental-mcp@beta
```

```sh [bun]
bun add @orpc/experimental-mcp@beta
```

```sh [deno]
deno add npm:@orpc/experimental-mcp@beta
```

:::

## Setup

Exposing a procedure to MCP is **opt-in**: annotate it with `mcp.tool`, `mcp.resource`, or `mcp.prompt`. MCP metadata is independent of any [`openapi`](/docs/openapi/routing) meta, so a single procedure can be served over REST and MCP at the same time.

```ts twoslash
import { mcp } from '@orpc/experimental-mcp'
import { os } from '@orpc/server'
import * as z from 'zod'

export const createPlanet = os
  .meta(mcp.tool({ description: 'Create a new planet' }))
  .input(z.object({ name: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handler(({ input }) => ({ id: crypto.randomUUID(), name: input.name }))

export const router = { createPlanet }
```

Then [serve the router](#serving) with one of the `MCPHandler` adapters.

## Tools

Tools are functions the model can call. A procedure's `.input()` becomes the tool's JSON Schema, its return value becomes the result, and its `.output()` adds an output schema plus structured content. Thrown [typed errors](/docs/error-handling) are reported back to the model as in-band tool errors, so it can react to them.

```ts
export const createPlanet = os
  .meta(mcp.tool({
    description: 'Create a new planet',
    annotations: { destructiveHint: false },
  }))
  .input(CreatingPlanetSchema)
  .output(PlanetSchema)
  .handler(({ input }) => create(input))
```

Behavior hints — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — go in `annotations`.

## Resources

Resources expose read-only data addressed by a URI. Use a fixed `uri` for a single resource, or a `uriTemplate` whose variables map to the procedure's input.

```ts
// Static resource
export const appConfig = os
  .meta(mcp.resource({ uri: 'config://app', mimeType: 'application/json' }))
  .output(ConfigSchema)
  .handler(() => getConfig())

// Templated resource — `{id}` is read from the input
export const planet = os
  .meta(mcp.resource({ uriTemplate: 'planet://{id}', mimeType: 'application/json' }))
  .input(z.object({ id: z.string() }))
  .output(PlanetSchema)
  .handler(({ input }) => findPlanet(input.id))
```

::: tip
Only annotate read-only, side-effect-free procedures as resources.
:::

## Prompts

Prompts are reusable templates a user can invoke. The arguments are derived from the procedure's `.input()`, and the handler returns the prompt messages.

```ts
export const planTrip = os
  .meta(mcp.prompt({ description: 'Plan a vacation' }))
  .input(z.object({ destination: z.string() }))
  .output(z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.object({ type: z.literal('text'), text: z.string() }),
    })),
  }))
  .handler(({ input }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Plan a trip to ${input.destination}` } }],
  }))
```

## Serving

`MCPHandler` speaks the MCP protocol over the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) transport (Fetch or Node.js) or over stdio. Pass the schema converter for your validation library — the same converters used by [`@orpc/openapi`](/docs/openapi/specification).

It is built on oRPC's standard request/response flow, so tool, resource, and prompt calls run through your [middleware](/docs/middleware), validation, and context, and any handler plugin (CORS, body limit, OpenTelemetry) composes as usual.

### Fetch

```ts
import { MCPHandler } from '@orpc/experimental-mcp/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

const handler = new MCPHandler(router, {
  serverInfo: { name: 'planets', version: '1.0.0' },
  converters: [new ZodToJsonSchemaConverter()],
})

export async function POST(request: Request) {
  const { response } = await handler.handle(request, { context: {} })
  return response ?? new Response('Not found', { status: 404 })
}
```

### Node.js

```ts
import { createServer } from 'node:http'
import { MCPHandler } from '@orpc/experimental-mcp/node'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

const handler = new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })

createServer((req, res) => handler.handle(req, res, { context: {} })).listen(3000)
```

### stdio

For clients that launch your server as a subprocess (Claude Desktop, IDEs):

```ts
import { MCPHandler } from '@orpc/experimental-mcp/stdio'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

await new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
  .listen({ context: {} })
```

## Authorization

Authentication and authorization are your application's responsibility — the integration stays unopinionated about tokens, scopes, and OAuth. Supply request-derived values as `context` when calling the handler, then enforce them with ordinary [middleware](/docs/middleware), which runs for every tool, resource, and prompt call.

```ts
export const authed = os.use(({ context, next, errors }) => {
  const user = verifyToken(context.authToken)
  if (!user)
    throw errors.UNAUTHORIZED()
  return next({ context: { user } })
})

export const deletePlanet = authed
  .meta(mcp.tool({ description: 'Delete a planet' }))
  .handler(({ context }) => remove(context.user))
```

A thrown `UNAUTHORIZED` reaches the model as an in-band tool error, or a resource/prompt request as a protocol error.

## Security

For HTTP servers reachable by browsers, enable Origin and Host validation to guard against DNS-rebinding attacks. A missing `Origin` header still passes, so non-browser clients are unaffected.

```ts
export const handler = new MCPHandler(router, {
  converters: [new ZodToJsonSchemaConverter()],
  enableDnsRebindingProtection: true,
  allowedOrigins: ['https://your-app.example'],
  allowedHosts: ['your-app.example'],
})
```

## One Router, Every Surface

Because MCP exposure lives in procedure metadata, a single router can be mounted on multiple handlers at once — RPC, OpenAPI, and MCP — over the same instance:

```ts
export const handlers = {
  rpc: new RPCHandler(router), // typed oRPC clients
  openapi: new OpenAPIHandler(router), // REST + OpenAPI
  mcp: new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] }), // MCP tools / resources / prompts
}
```

## Limitations

- Targets MCP revision `2025-11-25`; older revisions are accepted during negotiation.
- One JSON-RPC message per request — batching is not supported.
- Server-initiated streaming (the `GET` SSE channel), `listChanged`/`subscribe` notifications, and sessions are not implemented. These are being removed or replaced in the next MCP revision, so the stateless request/response design is intentional.
