# OpenAPI Cookie Parameters Support

**Date:** 2026-06-11  
**Status:** Approved

## Problem

oRPC's `inputStructure: 'detailed'` mode supports `params`, `query`, `headers`, and `body` as input keys. It does not support `cookies`. This means:

1. **OpenAPI spec is incorrect** — no `in: cookie` parameter objects are generated, even when the user reads cookies in their handler.
2. **Runtime validation is missing** — the `Cookie` request header is never parsed or exposed to Zod validation.

The OpenAPI spec supports cookie parameters as defined in [Swagger 3.0 — Cookie Parameters](https://swagger.io/docs/specification/v3_0/describing-parameters/#cookie-parameters).

## Scope

- `inputStructure: 'detailed'` only (not `compact`)
- Server-side: spec generation + runtime decode
- No client-side changes (browsers manage cookies automatically; can be added later)

## Architecture

```
User Schema (Zod)
  z.object({ session_id: z.string() })
        ↓
inputStructure: 'detailed' input shape
  { cookies: z.object({ session_id: z.string() }), ... }
        ↓
OpenAPI Generator
  in: cookie → ParameterObject[]
        ↓
StandardOpenAPICodec.decode()
  Cookie header → parsed key/value object → exposed as `cookies`
        ↓
Zod validation
  validates cookies like any other input field
```

All changes are confined to `packages/openapi`. No changes to `packages/contract` or `packages/server`.

## Changes

### 1. OpenAPI Generator — `packages/openapi/src/openapi-generator.ts`

**Line 389 — extend the loop over input structure keys:**

```ts
// Before:
for (const from of ['params', 'query', 'headers']) {
  const parameterIn: 'path' | 'query' | 'header' = from === 'params'
    ? 'path'
    : from === 'headers' ? 'header' : 'query'
  // ...
}

// After:
for (const from of ['params', 'query', 'headers', 'cookies']) {
  const parameterIn: 'path' | 'query' | 'header' | 'cookie' = from === 'params'
    ? 'path'
    : from === 'headers' ? 'header'
    : from === 'cookies' ? 'cookie'
    : 'query'
  // ...
}
```

**Line 366 — update the error message:**

```ts
// Before:
'When input structure is "detailed", input schema must satisfy: '
+ '{ params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, unknown>, body?: unknown }'

// After:
'When input structure is "detailed", input schema must satisfy: '
+ '{ params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, unknown>, cookies?: Record<string, unknown>, body?: unknown }'
```

No changes needed to `toOpenAPIParameters()` — it already accepts `'cookie'` as a valid `parameterIn` value.

### 2. Server Codec — `packages/openapi/src/adapters/standard/openapi-codec.ts`

**Add a cookie header parser** (private helper function or inline):

```ts
function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map((pair) => {
      const idx = pair.indexOf('=')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    }),
  )
}
```

**Extend the `decode()` return object** with a lazy `cookies` getter, consistent with the existing `query` lazy getter pattern:

```ts
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
  get cookies() {
    const value = parseCookieHeader(request.headers['cookie'] as string | undefined)
    Object.defineProperty(this, 'cookies', { value, writable: true })
    return value
  },
  set cookies(value) {
    Object.defineProperty(this, 'cookies', { value, writable: true })
  },
  body: this.serializer.deserialize(await request.body()),
}
```

Cookie values are always `string` — the existing Zod/JSON Schema smart coercion will convert them to the required types (numbers, booleans, etc.) during validation.

### 3. No changes required

- `packages/openapi/src/openapi-utils.ts` — `toOpenAPIParameters()` already handles `'cookie'`
- `packages/contract/src/route.ts` — `inputStructure` is a string enum; cookie support is defined by user's schema shape
- `packages/server/src/helpers/cookie.ts` — not used here; we parse the `Cookie` header directly

## Tests

### `packages/openapi/src/openapi-generator.test.ts`

- `inputStructure: 'detailed'` with `cookies` → generates `in: cookie` parameters correctly
- Error when `cookies` schema is not an object
- Combination: `cookies` + `headers` + `query` + `body` together

### `packages/openapi/src/openapi-utils.test.ts`

- `toOpenAPIParameters` with `parameterIn: 'cookie'` — verify `style`/`explode` are NOT added (cookie parameters do not support `deepObject` style)

### `packages/openapi/src/adapters/standard/openapi-codec.test.ts`

- `decode()` with `inputStructure: 'detailed'` and a `Cookie` request header → `cookies` key contains parsed key/value object
- `decode()` with no `Cookie` header → `cookies` is an empty object `{}`
- `decode()` with malformed `Cookie` header → graceful handling

## Usage Example

```ts
import { os } from '@orpc/server'
import { z } from 'zod'

const getProfile = os
  .route({
    method: 'GET',
    path: '/profile',
    inputStructure: 'detailed',
  })
  .input(
    z.object({
      cookies: z.object({
        session_id: z.string(),
      }),
    }),
  )
  .handler(({ input }) => {
    const { session_id } = input.cookies
    // session_id is validated and typed
  })
```

Generated OpenAPI spec:

```yaml
/profile:
  get:
    parameters:
      - name: session_id
        in: cookie
        required: true
        schema:
          type: string
```

## Out of Scope

- `inputStructure: 'compact'` cookie support
- Client-side cookie encoding (`openapi-link-codec.ts`)
- `Set-Cookie` response header in output structure
