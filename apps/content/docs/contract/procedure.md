# Procedure Contract

Procedure contracts define the expected shape of a [procedure](/docs/procedure) without including any business logic. They are useful for documentation, testing, and keeping multiple implementations of the same procedure aligned.

## Overview

```ts twoslash
import { z } from 'zod'
import type { AnyMetaPlugin } from '@orpc/contract'

declare const someMeta: AnyMetaPlugin
// ---cut---
import { oc } from '@orpc/contract'

const example = oc
  .meta(someMeta) // <- attach metadata
  .errors({ NOT_FOUND: {} }) // <- define errors
  .input(z.object({ id: z.number(), name: z.string() })) // <- input validation
  .output(z.object({ id: z.number(), name: z.string() })) // <- output validation
```

:::info
All of these chains are optional. You can create an empty contract with just `oc`.
:::

## Metadata

Use `.meta` to attach metadata to a contract. Middleware and plugins can read it later when you implement the contract. Learn more in the [Metadata documentation](/docs/metadata).

## Typesafe Errors

Use `.errors` to define the errors a contract can produce. These errors can be thrown from handlers or middleware when you implement the contract and remain properly typed on the client. Learn more in the [Typesafe Error Handling documentation](/docs/error-handling#typesafe-errors).

## Input/Output Validation

oRPC supports [Zod](https://zod.dev/), [Valibot](https://valibot.dev/), [Arktype](https://arktype.io/), and any other [Standard Schema](https://standardschema.dev/schema#what-schema-libraries-implement-the-spec) library for validation.

::: info
Unlike a [procedure](/docs/procedure), a contract has no `.handler` chain. If you want the client to infer the output type correctly, define `.output`. Otherwise, the output type will be `unknown`.
:::

### Multiple Schemas

`.input` and `.output` can be called multiple times. Each call adds another schema instead of replacing an earlier one.

```ts
const example = oc
  .input(z.looseObject({ name: z.string() }))
  .input(z.looseObject({ id: z.number() }))
  .output(z.looseObject({ name: z.string() }))
  .output(z.looseObject({ id: z.number() }))
```

::: warning
When you stack schemas, the input or output must satisfy all of them, so the schemas need to be compatible. For example, with Zod, prefer `z.looseObject` over `z.object` to allow unknown properties.
:::

### `type` Utility

For simple use cases without external libraries, use oRPC's built-in `type` utility. It takes a mapping function as its first argument:

```ts
import { type } from '@orpc/contract'

const example = oc
  .input(type<{ value: number }>())
  .output(type<{ value: number }, number>(({ value }) => value))
```

## Reusability

Each builder call creates a new instance, which avoids reference issues and makes contracts easy to reuse and extend.

```ts
const pub = oc // Base setup for procedures that publish
const authed = pub.meta(requireAuthMeta) // Extends 'pub' with authentication

const pubExample = pub
  .input(z.object({ name: z.string() }))

const authedExample = authed
  .input(z.object({ id: z.number() }))
```

This pattern helps prevent duplication while maintaining flexibility.
