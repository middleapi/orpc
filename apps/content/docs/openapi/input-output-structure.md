---
title: Input/Output Structure
description: Control how input and output data is structured in oRPC
---

# Input/Output Structure

oRPC allows you to control the organization of request inputs and response outputs using the `inputStructure` and `outputStructure` options. This is especially useful when you need to handle parameters, query strings, headers, and body data separately.

## Input Structure

The `inputStructure` option defines how the incoming request data is structured.

### Compact Mode (default)

Combines path parameters with query or body data (depending on the HTTP method) into a single object. Path parameters take precedence over query or body fields with the same name. If the path has parameters and the body cannot be merged (e.g. a primitive, array, or file), only the path parameters are used. Use detailed mode if you also need the body.

```ts
const compactMode = os.route({
  path: '/ping/{name}',
  method: 'POST',
})
  .input(z.object({
    name: z.string(),
    description: z.string().optional(),
  }))
```

### Detailed Mode

Provide an object whose fields correspond to each part of the request:

- `params`: Path parameters (`Record<string, string> | undefined`)
- `query`: Query string data (`any`)
- `headers`: Headers (`Record<string, string | string[] | undefined>`)
- `body`: Body data (`any`)

```ts
const detailedMode = os.route({
  path: '/ping/{name}',
  method: 'POST',
  inputStructure: 'detailed',
})
  .input(z.object({
    params: z.object({ name: z.string() }),
    query: z.object({ search: z.string() }),
    body: z.object({ description: z.string() }).optional(),
    headers: z.object({ 'x-custom-header': z.string() }),
  }))
```

## Output Structure

The `outputStructure` option determines the format of the response based on the output data.

### Compact Mode (default)

Returns the output data directly as the response body.

```ts
const compactMode = os
  .handler(async ({ input }) => {
    return { message: 'Hello, world!' }
  })
```

### Detailed Mode

Returns an object with these optional properties:

- `status`: The response status (must be in 200-399 range) if not set fallback to `successStatus`.
- `headers`: Custom headers to merge with the response headers (`Record<string, string | string[] | undefined>`).
- `body`: The response body.

```ts
const detailedMode = os
  .route({ outputStructure: 'detailed' })
  .handler(async ({ input }) => {
    return {
      headers: { 'x-custom-header': 'value' },
      body: { message: 'Hello, world!' },
    }
  })

const multipleStatus = os
  .route({ outputStructure: 'detailed' })
  .output(z.union([ // for openapi spec generator
    z.object({
      status: z.literal(201).describe('record created'),
      body: z.string()
    }),
    z.object({
      status: z.literal(200).describe('record updated'),
      body: z.string()
    }),
  ]))
  .handler(async ({ input }) => {
    if (something) {
      return {
        status: 201,
        body: 'created',
      }
    }

    return {
      status: 200,
      body: 'updated',
    }
  })
```

## Initial Configuration

Customize the initial oRPC input/output structure settings using `.$route`:

```ts
const base = os.$route({ inputStructure: 'detailed' })
```
