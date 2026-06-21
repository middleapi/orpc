# Client Error Handling

oRPC supports several ways to handle client-side errors. In most cases, `try/catch` is enough. If you use [Typesafe Errors](/docs/error-handling#typesafe-errors), `safe` and `createSafeClient` let you handle them with full type inference.

## Using `try/catch`

For most calls, use regular `try/catch`.

```ts
try {
  const data = await client.doSomething({ id: '123' })
}
catch (error) {
  // handle error
}
```

## Using `safe` and `isInferableError`

When working with [Typesafe Errors](/docs/error-handling#typesafe-errors), use `safe` to preserve error type inference. It behaves like `try/catch`, but returns the typesafe result instead of throwing.

```ts twoslash
import { call, os } from '@orpc/server'
import * as z from 'zod'
// ---cut---
import { isInferableError, safe } from '@orpc/client'

const exampleProcedure = os
  .input(z.object({ id: z.string() }))
  .errors({
    RATE_LIMIT_EXCEEDED: {
      data: z.object({ retryAfter: z.number() })
    }
  })
  .handler(async ({ input, errors }) => {
    throw errors.RATE_LIMIT_EXCEEDED({ data: { retryAfter: 1000 } })
  })

// or { error, data, inferableError }
const [error, data, inferableError] = await safe(
  call(exampleProcedure, { id: '123' })
)

if (isInferableError(error)) { // or inferableError
  // handle inferable error

  // or inferableError.data.retryAfter
  console.log(error.data.retryAfter)
}
else if (error) {
  // handle unknown error
}
else {
  // handle success
  console.log(data)
}
```

::: info
`safe` supports both tuple and object forms:

- `[error, data, inferableError]`
- `{ error, data, inferableError }`

`inferableError` is the same value as `error` when `isInferableError(error)` returns `true`; otherwise it is `null`.
:::

## Safe Client

If you use `safe` often, `createSafeClient` can reduce repetition by wrapping entire client calls with `safe`.

```ts
import { createSafeClient } from '@orpc/client'

const safeClient = createSafeClient(client)

const [error, data] = await safeClient.doSomething({ id: '123' })
```
