# OpenAPI Cookie Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cookies` as a supported key in `inputStructure: 'detailed'` so oRPC generates correct `in: cookie` OpenAPI parameters and validates cookie values server-side.

**Architecture:** Two targeted changes in `packages/openapi`: (1) extend the generator loop to include `'cookies'` → `'cookie'` mapping, (2) parse the `Cookie` request header in the server codec and expose it as `cookies` using the same lazy-getter pattern as `query`. No changes to other packages.

**Tech Stack:** TypeScript, Vitest, `@orpc/openapi` package internals.

---

## File Map

| File | Change |
|---|---|
| `packages/openapi/src/openapi-generator.ts` | Extend loop + update error message |
| `packages/openapi/src/adapters/standard/openapi-codec.ts` | Add `parseCookieHeader` + lazy `cookies` getter in `decode()` |
| `packages/openapi/src/openapi-utils.test.ts` | Add `toOpenAPIParameters` test for `'cookie'` |
| `packages/openapi/src/openapi-generator.test.ts` | Add generator tests for `cookies` key |
| `packages/openapi/src/adapters/standard/openapi-codec.test.ts` | Add codec `decode()` tests for cookies |

---

## Task 1: `toOpenAPIParameters` — test that cookie parameters have no `style`/`explode`/`allowEmptyValue`/`allowReserved`

**Files:**
- Modify: `packages/openapi/src/openapi-utils.test.ts` (after line 303)

The `toOpenAPIParameters` function already accepts `'cookie'` as a `parameterIn`. This task verifies it behaves correctly: no `deepObject` style, no `allowEmptyValue`, no `allowReserved`.

- [ ] **Step 1: Write the failing test**

Open `packages/openapi/src/openapi-utils.test.ts`. After the existing `'query'` test block (around line 302), add a new `'cookie'` test inside the `describe('toOpenAPIParameters')` block:

```ts
it('cookie', () => {
  expect(toOpenAPIParameters(schema, 'cookie')).toEqual([{
    name: 'a',
    in: 'cookie',
    required: true,
    schema: {
      type: 'string',
    },
  }, {
    name: 'b',
    in: 'cookie',
    required: false,
    schema: {
      type: 'object',
      properties: {
        b1: { type: 'number' },
        b2: { type: 'string' },
      },
      required: ['b1'],
    },
  }, {
    name: 'c',
    in: 'cookie',
    required: true,
    schema: {
      oneOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },
      ],
    },
  }])
})
```

The `schema` variable is already defined at line 207 of the test file — use the same one.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/openapi && pnpm vitest run src/openapi-utils.test.ts
```

Expected: this new test **passes immediately** (the function already handles `'cookie'` correctly — `parameterIn !== 'query'` sets `isDeepObjectStyle = false`). If it passes, skip to Step 3.

- [ ] **Step 3: Commit**

```bash
git add packages/openapi/src/openapi-utils.test.ts
git commit -m "test(openapi): verify toOpenAPIParameters handles cookie parameterIn"
```

---

## Task 2: Generator — add `cookies` to `inputStructure: 'detailed'` loop

**Files:**
- Modify: `packages/openapi/src/openapi-generator.ts` (lines 364–407)

- [ ] **Step 1: Write the failing generator test**

Open `packages/openapi/src/openapi-generator.test.ts`. Find the `inputTests` array. After the existing `'inputStructure=detailed'` test case (around line 391), add two new test cases inside the `inputTests` array:

```ts
{
  name: 'inputStructure=detailed with cookies',
  contract: oc.route({ inputStructure: 'detailed' }).input(z.object({
    cookies: z.object({ session_id: z.string(), theme: z.string().optional() }),
  })),
  expected: {
    '/': {
      post: expect.objectContaining({
        parameters: [
          {
            name: 'session_id',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'theme',
            in: 'cookie',
            required: false,
            schema: { type: 'string' },
          },
        ],
      }),
    },
  },
},
{
  name: 'inputStructure=detailed with cookies + headers + query + body',
  contract: oc.route({ inputStructure: 'detailed' }).input(z.object({
    cookies: z.object({ session_id: z.string() }),
    headers: z.object({ 'x-request-id': z.string() }),
    query: z.object({ page: z.number().optional() }),
    body: z.string(),
  })),
  expected: {
    '/': {
      post: expect.objectContaining({
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: 'session_id', in: 'cookie' }),
          expect.objectContaining({ name: 'x-request-id', in: 'header' }),
          expect.objectContaining({ name: 'page', in: 'query' }),
        ]),
        requestBody: expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { type: 'string' },
            }),
          }),
        }),
      }),
    },
  },
},
{
  name: 'inputStructure=detailed + invalid cookies (not an object)',
  contract: oc.route({ inputStructure: 'detailed' }).input(z.object({ cookies: z.string() })),
  error: 'When input structure is "detailed", input schema must satisfy',
},
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/openapi && pnpm vitest run src/openapi-generator.test.ts --reporter=verbose 2>&1 | grep -A5 "cookies"
```

Expected: the `'inputStructure=detailed with cookies'` test fails because cookies are not yet handled.

- [ ] **Step 3: Implement the generator change**

Open `packages/openapi/src/openapi-generator.ts`.

**Change 1** — update error message at line 365–366:

```ts
// BEFORE:
    const error = new OpenAPIGeneratorError(
      'When input structure is "detailed", input schema must satisfy: '
      + '{ params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, unknown>, body?: unknown }',
    )

// AFTER:
    const error = new OpenAPIGeneratorError(
      'When input structure is "detailed", input schema must satisfy: '
      + '{ params?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, unknown>, cookies?: Record<string, unknown>, body?: unknown }',
    )
```

**Change 2** — extend the loop at lines 389–407:

```ts
// BEFORE:
    for (const from of ['params', 'query', 'headers']) {
      const fromSchema = schema.properties?.[from]
      if (fromSchema !== undefined) {
        const resolvedSchema = simplifyComposedObjectJsonSchemasAndRefs(fromSchema, doc)

        if (!isObjectSchema(resolvedSchema)) {
          throw error
        }

        const parameterIn: 'path' | 'query' | 'header' = from === 'params'
          ? 'path'
          : from === 'headers'
            ? 'header'
            : 'query'

        ref.parameters ??= []
        ref.parameters.push(...toOpenAPIParameters(resolvedSchema, parameterIn))
      }
    }

// AFTER:
    for (const from of ['params', 'query', 'headers', 'cookies']) {
      const fromSchema = schema.properties?.[from]
      if (fromSchema !== undefined) {
        const resolvedSchema = simplifyComposedObjectJsonSchemasAndRefs(fromSchema, doc)

        if (!isObjectSchema(resolvedSchema)) {
          throw error
        }

        const parameterIn: 'path' | 'query' | 'header' | 'cookie' = from === 'params'
          ? 'path'
          : from === 'headers'
            ? 'header'
            : from === 'cookies'
              ? 'cookie'
              : 'query'

        ref.parameters ??= []
        ref.parameters.push(...toOpenAPIParameters(resolvedSchema, parameterIn))
      }
    }
```

- [ ] **Step 4: Run generator tests to verify they pass**

```bash
cd packages/openapi && pnpm vitest run src/openapi-generator.test.ts
```

Expected: all tests pass, including the new cookie tests.

- [ ] **Step 5: Commit**

```bash
git add packages/openapi/src/openapi-generator.ts packages/openapi/src/openapi-generator.test.ts
git commit -m "feat(openapi): support cookies in inputStructure detailed generator"
```

---

## Task 3: Codec — parse Cookie header and expose as `cookies` in `decode()`

**Files:**
- Modify: `packages/openapi/src/adapters/standard/openapi-codec.ts`

- [ ] **Step 1: Write the failing codec tests**

Open `packages/openapi/src/adapters/standard/openapi-codec.test.ts`. Inside the `describe('with detailed structure')` block (around line 79), after the existing `'can set query'` test, add:

```ts
it('cookies are parsed from Cookie header', async () => {
  serializer.deserialize.mockReturnValue(undefined)

  const url = new URL('http://localhost/api/v1')

  const input = await codec.decode({
    method: 'POST',
    url,
    body: vi.fn(async () => undefined),
    headers: {
      'cookie': 'session_id=abc123; theme=dark',
    },
    signal: undefined,
  }, undefined, procedure) as any

  expect(input.cookies).toEqual({ session_id: 'abc123', theme: 'dark' })
})

it('cookies is empty object when no Cookie header', async () => {
  serializer.deserialize.mockReturnValue(undefined)

  const url = new URL('http://localhost/api/v1')

  const input = await codec.decode({
    method: 'POST',
    url,
    body: vi.fn(async () => undefined),
    headers: {},
    signal: undefined,
  }, undefined, procedure) as any

  expect(input.cookies).toEqual({})
})

it('can set cookies', async () => {
  serializer.deserialize.mockReturnValue(undefined)

  const url = new URL('http://localhost/api/v1')

  const input = await codec.decode({
    method: 'POST',
    url,
    body: vi.fn(async () => undefined),
    headers: {
      'cookie': 'session_id=abc123',
    },
    signal: undefined,
  }, undefined, procedure) as any

  input.cookies = { session_id: 'override' }
  expect(input.cookies).toEqual({ session_id: 'override' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/openapi && pnpm vitest run src/adapters/standard/openapi-codec.test.ts
```

Expected: the three new cookie tests fail because `input.cookies` is `undefined`.

- [ ] **Step 3: Implement the codec change**

Open `packages/openapi/src/adapters/standard/openapi-codec.ts`.

**Add `parseCookieHeader` as a module-level private function** before the `StandardOpenAPICodec` class definition (around line 23):

```ts
function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader)
    return {}
  return Object.fromEntries(
    cookieHeader.split(';').map((pair) => {
      const idx = pair.indexOf('=')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    }),
  )
}
```

**Extend the `decode()` return object** for `inputStructure: 'detailed'` (lines 59–72). Replace the current return statement:

```ts
// BEFORE:
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

// AFTER:
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

- [ ] **Step 4: Run codec tests to verify they pass**

```bash
cd packages/openapi && pnpm vitest run src/adapters/standard/openapi-codec.test.ts
```

Expected: all tests pass, including the three new cookie tests.

- [ ] **Step 5: Commit**

```bash
git add packages/openapi/src/adapters/standard/openapi-codec.ts packages/openapi/src/adapters/standard/openapi-codec.test.ts
git commit -m "feat(openapi): parse Cookie header into cookies in detailed input structure decode"
```

---

## Task 4: Full test suite verification

- [ ] **Step 1: Run the full openapi package test suite**

```bash
cd packages/openapi && pnpm vitest run
```

Expected: all tests pass with no regressions.

- [ ] **Step 2: Run the full monorepo test suite**

```bash
cd /Users/me/Projects/github/orpc && pnpm test --filter @orpc/openapi
```

Expected: all tests pass.

- [ ] **Step 3: TypeScript type check**

```bash
cd packages/openapi && pnpm tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit if needed**

If any fixes were required in steps 1–3, commit them now.

```bash
git add -A
git commit -m "fix(openapi): address type/test issues in cookie parameter support"
```
