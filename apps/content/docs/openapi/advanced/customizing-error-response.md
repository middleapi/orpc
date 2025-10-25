---
title: Customizing Error Response Format
description: Learn how to customize the error response format in oRPC OpenAPI to match your application's requirements and improve client compatibility.
---

# Customizing Error Response Format

By default, [OpenAPIHandler](/docs/openapi/openapi-handler), [OpenAPIGenerator](/docs/openapi/openapi-specification), and [OpenAPILink](/docs/openapi/client/openapi-link) share the same error response format. You can customize one, some, or all of them based on your requirements.

::: info
The examples below use options very close to the default behavior.
:::

## `OpenAPIHandler`

Use `customErrorResponseBodyEncoder` in [OpenAPIHandler](/docs/openapi/openapi-handler) to customize how an `ORPCError` is formatted in the response.

```ts
const handler = new OpenAPIHandler(router, {
  customErrorResponseBodyEncoder(error) {
    return error.toJSON()
  },
})
```

::: info
Return `null` or `undefined` from `customErrorResponseBodyEncoder` to fallback to the default behavior.
:::

## `OpenAPIGenerator`

When using [type-safe errors](/docs/error-handling#type‐safe-error-handling), customize the error response format in [OpenAPIGenerator](/docs/openapi/openapi-specification) with `customErrorResponseBodySchema` to match your application's actual error responses.

```ts
const generator = new OpenAPIGenerator()

const spec = await generator.generate(router, {
  customErrorResponseBodySchema: (definedErrorDefinitions, status) => {
    const result: Record<any, any> = {
      oneOf: [
        {
          type: 'object',
          properties: {
            defined: { const: false }, // for normal errors
            code: { type: 'string' },
            status: { type: 'number' },
            message: { type: 'string' },
            data: {},
          },
          required: ['defined', 'code', 'status', 'message'],
        },
      ],
    }

    for (const [code, defaultMessage, dataRequired, dataSchema] of definedErrorDefinitions) {
      result.oneOf.push({
        type: 'object',
        properties: {
          defined: { const: true }, // for typesafe errors
          code: { const: code },
          status: { const: status },
          message: { type: 'string', default: defaultMessage },
          data: dataSchema,
        },
        required: dataRequired ? ['defined', 'code', 'status', 'message', 'data'] : ['defined', 'code', 'status', 'message'],
      })
    }

    return result
  }
})
```

::: info
Return `null` or `undefined` from `customErrorResponseBodySchema` to fallback to the default behavior.
:::

## `OpenAPILink`

When your backend isn't oRPC or uses a custom error format, you can instruct [OpenAPILink](/docs/openapi/client/openapi-link) how to parse it to an `ORPCError` using the `customErrorResponseBodyDecoder` option.

```ts
const link = OpenAPILink(contract, {
  customErrorResponseBodyDecoder: (body, response) => {
    if (isORPCErrorJson(body)) {
      return createORPCErrorFromJson(body)
    }

    return null // default behavior supports any error format
  }
})
```

::: info
Return `null` or `undefined` from `customErrorResponseBodyDecoder` to fallback to the default behavior.
:::
