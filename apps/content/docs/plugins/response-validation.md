# Response Validation Plugin

**Response Validation Plugin** validates server responses against your contract before your application uses them. This helps ensure the data returned by the server matches the types defined in your contract.

## Setup

```ts
import { ResponseValidationLinkPlugin } from '@orpc/contract/plugins'

const link = new RPCLink({
  plugins: [
    new ResponseValidationLinkPlugin(contract),
  ],
})
```

::: info
If you do not have a [contract](/docs/contract-first/define-contract), you can use a [unlazied router](/docs/contract-first/router-to-contract#unlazy) instead.
:::

<!--@include: @/shared/common-plugin-link-compatibility.md -->

## Limitations

Schemas that transform values into a different type are not supported.

**Why?** Consider this schema, which accepts a `number` and transforms it into a `string`:

```ts
const unsupported = z.number().transform(value => value.toString())
```

When the server validates the output, it transforms the `number` into a `string`. The client then receives that `string`, but the schema still expects a `number` as input, so validation fails.

## Typesafe Errors Compatibility

This plugin reconciles ORPC errors from other interceptors and plugins, allowing you to use `ORPCError` for [typesafe errors](/docs/error-handling#orpcerror-compatibility).

## Custom Validation Errors

If you have already [customized validation errors on the server](/docs/advanced/validation-errors), you can use interceptors to catch and map the validation errors thrown by this plugin so they match your server-side errors.

```ts
import { ORPCError } from '@orpc/client'
import { ValidationError } from '@orpc/contract'

const link = new RPCLink({
  plugins: [
    new ResponseValidationLinkPlugin(contract),
  ],
  interceptors: [
    async ({ next }) => {
      try {
        return await next()
      }
      catch (error) {
        if (
          error instanceof ORPCError
          && error.code === 'INTERNAL_SERVER_ERROR'
          && error.cause instanceof ValidationError
        ) {
          throw new CustomOutputValidationError(error.cause.issues)
        }

        throw error
      }
    }
  ]
})
```

## Advanced Usage

You can also use this plugin in guides such as [Expanding Type Support for OpenAPI Link](/docs/advanced/expanding-type-support-for-openapi-link).

## Learn More

For implementation details, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/contract/src/plugins/response-validation.ts).
