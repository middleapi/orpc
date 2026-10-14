---
title: Zod Smart Coercion
description: A refined alternative to `z.coerce` that automatically converts inputs to the expected type without modifying the input schema.
---

# Zod Smart Coercion

A Plugin refined alternative to `z.coerce` that automatically converts inputs to the expected type without modifying the input schema.

::: warning
In Zod v4, this plugin only supports **discriminated unions**. Regular (non-discriminated) unions are **not** coerced automatically.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/zod@latest
```

```sh [yarn]
yarn add @orpc/zod@latest
```

```sh [pnpm]
pnpm add @orpc/zod@latest
```

```sh [bun]
bun add @orpc/zod@latest
```

```sh [deno]
deno add npm:@orpc/zod@latest
```

:::

## Setup

```ts
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ZodSmartCoercionPlugin } from '@orpc/zod' // <-- zod v3
import {
  experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin
} from '@orpc/zod/zod4' // <-- zod v4

const handler = new OpenAPIHandler(router, {
  plugins: [new ZodSmartCoercionPlugin()]
})
```

:::warning
Do not use this plugin with [RPCHandler](/docs/rpc-handler) as it may negatively impact performance.
:::

## Safe and Predictable Conversion

Zod Smart Coercion converts data only when:

1. The schema expects a specific type and the input can be converted.
2. The input does not already match the schema.

For example:

- If the input is `'true'` but the schema does not expect a boolean, no conversion occurs.
- If the schema accepts both boolean and string, `'true'` will not be coerced to a boolean.

### Conversion Rules

#### Boolean

Converts string representations of boolean values:

```ts
const raw = 'true' // Input
const coerced = true // Output
```

Supported values:

- `'true'`, `'on'`, `'t'` → `true`
- `'false'`, `'off'`, `'f'` → `false`

#### Number

Converts numeric strings:

```ts
const raw = '42' // Input
const coerced = 42 // Output
```

#### BigInt

Converts strings representing valid BigInt values:

```ts
const raw = '12345678901234567890' // Input
const coerced = 12345678901234567890n // Output
```

Strings longer than 4300 digits are left unchanged.

#### Date

Converts valid date strings into Date objects:

```ts
const raw = '2024-11-27T00:00:00.000Z' // Input
const coerced = new Date('2024-11-27T00:00:00.000Z') // Output
```

Supported formats:

- Full ISO date-time (e.g., `2024-11-27T00:00:00.000Z`)
- Date only (e.g., `2024-11-27`)

#### RegExp

Converts strings representing regular expressions:

```ts
const raw = '/^abc$/i' // Input
const coerced = /^abc$/i // Output
```

#### URL

Converts valid URL strings into URL objects:

```ts
const raw = 'https://example.com' // Input
const coerced = new URL('https://example.com') // Output
```

#### Set

Converts arrays into Set objects, removing duplicates:

```ts
const raw = ['apple', 'banana', 'apple'] // Input
const coerced = new Set(['apple', 'banana']) // Output
```

#### Map

Converts arrays of key-value pairs into Map objects:

```ts
const raw = [
  ['key1', 'value1'],
  ['key2', 'value2']
] // Input

const coerced = new Map([
  ['key1', 'value1'],
  ['key2', 'value2']
]) // Output
```
