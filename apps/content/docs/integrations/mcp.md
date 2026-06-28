---
title: MCP
description: Expose your oRPC router as a Model Context Protocol (MCP) server — tools, resources, and prompts — alongside RPC and OpenAPI.
---

# Model Context Protocol (MCP)

[`@orpc/mcp`](https://www.npmjs.com/package/@orpc/mcp) turns an oRPC router into an [MCP](https://modelcontextprotocol.io) server, so the **same** procedures you already serve over RPC and OpenAPI can be called by MCP clients (Claude, ChatGPT, IDEs, agents).

Exposure is **opt-in**: only procedures annotated with `mcp.tool` / `mcp.resource` / `mcp.prompt` are visible to MCP clients. The procedure's `.input()` schema becomes the tool's JSON Schema `inputSchema`, and `.output()` becomes its `outputSchema` — reusing the same converters as [`@orpc/openapi`](/docs/openapi/openapi-specification).

## Installation

::: code-group

```sh [npm]
npm install @orpc/mcp@latest
```

```sh [pnpm]
pnpm add @orpc/mcp@latest
```

```sh [yarn]
yarn add @orpc/mcp@latest
```

```sh [bun]
bun add @orpc/mcp@latest
```

:::

## Annotate procedures

Annotate a procedure with `mcp.tool`, `mcp.resource`, or `mcp.prompt`. MCP metadata is independent of `openapi()` — a procedure can carry both.

```ts twoslash
import { os } from '@orpc/server'
import { mcp } from '@orpc/mcp'
import * as z from 'zod'

// Tool (the default) — the model can call it
export const createPlanet = os
  .meta(mcp.tool({
    description: 'Create a new planet',
    annotations: { destructiveHint: false },
  }))
  .input(z.object({ name: z.string(), description: z.string().optional() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handler(({ input }) => ({ id: crypto.randomUUID(), name: input.name }))

// Resource — read-only data, addressed by a URI template (vars map to input)
export const planet = os
  .meta(mcp.resource({ uriTemplate: 'planet://{id}', mimeType: 'application/json' }))
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handler(({ input }) => ({ id: input.id, name: `Planet ${input.id}` }))

// Prompt — arguments come from .input(), messages from the handler's return
export const planTrip = os
  .meta(mcp.prompt({ description: 'Plan a vacation' }))
  .input(z.object({ destination: z.string(), days: z.number() }))
  .output(z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.object({ type: z.literal('text'), text: z.string() }),
    })),
  }))
  .handler(({ input }) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Plan ${input.days} days in ${input.destination}` } }],
  }))

export const router = { createPlanet, planet, planTrip }
```

### Meta options

The primitive is chosen by which factory you call (`mcp.tool` / `mcp.resource` /
`mcp.prompt`); the remaining fields are:

| Field          | Applies to | Description                                                                            |
| -------------- | ---------- | -------------------------------------------------------------------------------------- |
| `name`         | all        | Identifier in the server. Defaults to the router path joined by `_`.                   |
| `title`        | all        | Human-readable display name.                                                           |
| `description`  | all        | Explanation used by the model to decide when/how to use it.                            |
| `annotations`  | tool       | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.                  |
| `outputSchema` | tool       | Emit an MCP `outputSchema` from `.output()` (default: `true` when `.output()` is set). |
| `uri`          | resource   | Fixed URI of a static resource (e.g. `config://app`).                                  |
| `uriTemplate`  | resource   | Templated URI (e.g. `planet://{id}`); variables bind to the procedure input.           |
| `mimeType`     | resource   | MIME type of the resource contents.                                                    |

## Serve it

`MCPHandler` speaks the MCP protocol (`initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`) over the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) transport (fetch/node) or stdio. Pass the schema converters for your validation library.

### Streamable HTTP (fetch)

```ts
import { MCPHandler } from '@orpc/mcp/fetch'
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

`MCPHandler` is built on oRPC's `StandardHandler`: `tools/call` / `resources/read`
/ `prompts/get` run through the normal procedure pipeline (middleware, validation,
context) and accept any `StandardHandler` plugin (CORS, body-limit, OpenTelemetry),
while the MCP protocol routes (`initialize`, the `list` methods, …) are answered
by an auto-registered plugin.

### Security (DNS-rebinding / Origin)

For browser-facing HTTP servers, enable Origin/Host validation (a missing `Origin`
still passes, for non-browser clients):

```ts
export const handler = new MCPHandler(router, {
  converters: [new ZodToJsonSchemaConverter()],
  enableDnsRebindingProtection: true,
  allowedOrigins: ['https://your-app.example'],
  allowedHosts: ['your-app.example'],
})
```

Request body size is bounded via oRPC's `BodyLimitHandlerPlugin` (node) — pass it
in `plugins`.

### Streamable HTTP (Node.js)

```ts
import { createServer } from 'node:http'
import { MCPHandler } from '@orpc/mcp/node'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

const handler = new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })

createServer((req, res) => {
  handler.handle(req, res, { context: {} })
}).listen(3000)
```

### stdio (local servers)

For MCP clients that launch your server as a subprocess (Claude Desktop, IDEs):

```ts
import { MCPHandler } from '@orpc/mcp/stdio'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

await new MCPHandler(router, { converters: [new ZodToJsonSchemaConverter()] })
  .listen({ context: {} })
```

## One router, every surface

Because MCP exposure lives in procedure meta, a single router can be mounted on multiple handlers — RPC, OpenAPI, and MCP — at different paths over the same instance:

```ts
export const handlers = {
  rpc: new RPCHandler(router), // /rpc  — typed oRPC clients
  openapi: new OpenAPIHandler(router), // /api  — REST + OpenAPI spec
  mcp: new MCPHandler(router), // /mcp  — MCP tools / resources / prompts
}
```

## How it maps

| oRPC                             | MCP                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `.input()` schema                | tool `inputSchema` / prompt `arguments` / resource template variables                   |
| `.output()` schema               | tool `outputSchema` (+ `structuredContent`) / prompt `messages` / resource `contents`   |
| handler return value             | tool `content[]` (+ `structuredContent`), resource `contents[]`, or prompt `messages[]` |
| thrown `errors.*()` (typed)      | in-band tool result with `isError: true` (so the model can react)                       |
| `ORPCError` in a resource/prompt | JSON-RPC protocol error                                                                 |

## Authorization

Authentication and authorization are the **application's** responsibility — `@orpc/mcp` is unopinionated about tokens, scopes, or OAuth servers. Use oRPC's normal context + middleware; the MCP handler runs it for every `tools/call` / `resources/read` / `prompts/get`. Supply request-derived values as `context` at the transport boundary (`handler.handle(request, { context: { authToken: request.headers.get('authorization') } })`), then enforce with middleware:

```ts
export const authed = os.use(({ context, next, errors }) => {
  const user = verifyToken(context.authToken) // your token format / scopes
  if (!user)
    throw errors.UNAUTHORIZED()
  return next({ context: { user } })
})

export const deletePlanet = authed
  .meta(mcp.tool({ description: 'Delete a planet' }))
  .handler(({ context }) => context.user.id)
```

A thrown `UNAUTHORIZED` surfaces as an in-band tool error (tools) or a JSON-RPC error (resources/prompts). The OAuth _discovery_ handshake (HTTP `401` + `WWW-Authenticate` + RFC 9728 metadata) belongs at your HTTP layer in front of the handler.

## Pagination

Two distinct kinds:

- **Catalog pagination** (the cursor on `tools/list` / `resources/list` / `prompts/list`) is **built in**. Set `pageSize` to page the server's catalog; catalogs at or under the page size return a single page. Cursors are opaque and an invalid one returns `-32602`.

  ```ts
  export const handler = new MCPHandler(router, {
    converters: [new ZodToJsonSchemaConverter()],
    pageSize: 50,
  })
  ```

- **Result pagination** (a tool that returns many rows) is the **developer's** job — model it in the tool's own `.input()`/`.output()`, like any API:

  ```ts
  export const listPlanets = os
    .meta(mcp.tool({ description: 'List planets' }))
    .input(z.object({ cursor: z.number().int().min(0).default(0), limit: z.number().int().max(100).default(20) }))
    .output(z.object({ items: z.array(PlanetSchema), nextCursor: z.number().optional() }))
    .handler(({ input }) => paginatePlanets(input.cursor, input.limit))
  ```

## Notes & limitations

- Targets MCP protocol revision `2025-11-25` (negotiated at `initialize`; older revisions are accepted).
- One JSON-RPC message per request — **JSON-RPC batching is not supported** (incompatible with the standard one-request/one-procedure flow, and deprecated in the MCP spec direction).
- Server → client streaming (`GET` SSE), `listChanged`/`subscribe` notifications, and sessions (`Mcp-Session-Id`) are not implemented — and are being **removed/replaced in the next MCP revision**, so the stateless POST→response design is intentional.
- Resource handlers should be side-effect free; only annotate read-only procedures as resources.
