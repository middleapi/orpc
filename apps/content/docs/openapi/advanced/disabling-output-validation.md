---
title: Disabling Output Validation
description: Learn how to disable output validation in oRPC procedures for improved performance while maintaining OpenAPI specification generation.
---

# Disabling Output Validation

By default, oRPC validates procedure outputs against their [defined schemas](/docs/procedure#input-output-validation) to ensure data consistency and type safety. If you only define output schemas for [OpenAPI specification generation](/docs/openapi/openapi-specification), you can disable output validation to improve performance.

## Configuration

Set `initialOutputValidationIndex` to `NaN` in the [`$config`](/docs/procedure#initial-configuration) method:

```ts
import { os } from '@orpc/server'

const base = os
  .$config({
    initialOutputValidationIndex: Number.NaN, // [!code highlight]
  })
```

All procedures built from `base` will now have output validation disabled.

## Limitation

This approach will not work correctly if your schema transforms the data into a different type during validation.

```ts twoslash
import { os } from '@orpc/server'
import { z } from 'zod'

const base = os
  .$config({
    initialOutputValidationIndex: Number.NaN,
  })
// ---cut---

const procedure = base
  .output(z.object({ value: z.number().transform(val => String(val)) }))
  .handler(() => {
    return { value: 123 }
  })
  .callable()

const { value } = await procedure()
```

In this example, the client expects `value` to be a `string`, but because output validation is disabled, the transform logic is skipped. The client will receive a `number` instead, causing type mismatches.
