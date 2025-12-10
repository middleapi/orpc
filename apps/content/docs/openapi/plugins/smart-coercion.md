---
title: Smart Coercion Plugin
description: Automatically converts input values to match schema types without manually defining coercion logic.
---

# Smart Coercion Plugin

Automatically converts input values to match schema types without manually defining coercion logic.

::: warning
This plugin improves developer experience but impacts performance. For high-performance applications or complex schemas, manually defining coercion in your schema validation is more efficient.
:::

## Installation

::: code-group

```sh [npm]
npm install @orpc/json-schema@latest
```

```sh [yarn]
yarn add @orpc/json-schema@latest
```

```sh [pnpm]
pnpm add @orpc/json-schema@latest
```

```sh [bun]
bun add @orpc/json-schema@latest
```

```sh [deno]
deno add npm:@orpc/json-schema@latest
```

:::

## Setup

Configure the plugin with [JSON Schema Converters](/docs/openapi/openapi-specification#generating-specifications) for your validation libraries.

```ts
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { SmartCoercionPlugin } from '@orpc/json-schema'

const handler = new OpenAPIHandler(router, {
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [
        new ZodToJsonSchemaConverter(),
        // Add other schema converters as needed
      ],
    })
  ]
})
```

## How It Works

The plugin converts values **safely** using these rules:

1. **Schema-guided:** Only converts when the schema says what type to use
2. **Safe only:** Only converts values that make sense (like `'123'` to `123`)
3. **Keep original:** If conversion is unsafe, keeps the original value
4. **Smart unions:** Picks the best conversion for union types
5. **Deep conversion:** Works inside nested objects and arrays

::: info
JavaScript native types such as BigInt, Date, RegExp, URL, Set, and Map are not natively supported by JSON Schema. To enable correct coercion, oRPC relies on the `x-native-type` metadata in your schema:

- `x-native-type: 'bigint'` for BigInt
- `x-native-type: 'date'` for Date
- `x-native-type: 'regexp'` for RegExp
- `x-native-type: 'url'` for URL
- `x-native-type: 'set'` for Set
- `x-native-type: 'map'` for Map

The built-in [JSON Schema Converters](/docs/openapi/openapi-specification#generating-specifications) handle these cases (except for some experimental converters). Since this approach is not part of the official JSON Schema specification, if you use a custom converter, you may need to add the appropriate `x-native-type` metadata to your schemas to ensure proper coercion.
:::

## Conversion Rules

### String → Boolean

Support specific string values (case-insensitive):

- `'true'`, `'on'` → `true`
- `'false'`, `'off'` → `false`

::: info
HTML `<input type="checkbox">` elements submit `'on'` or `'off'` as values, so this conversion is especially useful for handling checkbox input in forms.
:::

### String → Number

Support valid numeric strings:

- `'123'` → `123`
- `'3.14'` → `3.14`

### String/Number → BigInt

Support valid numeric strings or numbers:

- `'12345678901234567890'` → `12345678901234567890n`
- `12345678901234567890` → `12345678901234567890n`

### String → Date

Support ISO date/datetime strings:

- `'2023-10-01'` → `new Date('2023-10-01')`
- `'2020-01-01T06:15'` → `new Date('2020-01-01T06:15')`
- `'2020-01-01T06:15Z'` → `new Date('2020-01-01T06:15Z')`
- `'2020-01-01T06:15:00Z'` → `new Date('2020-01-01T06:15:00Z')`
- `'2020-01-01T06:15:00.123Z'` → `new Date('2020-01-01T06:15:00.123Z')`

### String → RegExp

Support valid regular expression strings:

- `'/^\\d+$/i'` → `new RegExp('^\\d+$', 'i')`
- `'/abc/'` → `new RegExp('abc')`

### String → URL

Support valid URL strings:

- `'https://example.com'` → `new URL('https://example.com')`

### Array → Set

Support arrays of **unique values**:

- `['apple', 'banana']` → `new Set(['apple', 'banana'])`

### Array → Object

Converts arrays to objects with numeric keys:

- `['apple', 'banana']` → `{ 0: 'apple', 1: 'banana' }`

::: info
This is particularly useful for [Bracket Notation](/docs/openapi/bracket-notation) when you need objects with numeric keys.
:::

### Array → Map

Support arrays of key-value pairs with **unique keys**:

- `[['key1', 'value1'], ['key2', 'value2']]` → `new Map([['key1', 'value1'], ['key2', 'value2']])`
