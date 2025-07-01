---
title: Metadata
description: Enhance your procedures with metadata.
---

# Metadata

oRPC procedures support metadata, simple key-value pairs that provide extra information to customize behavior.

## Basic Example

```ts twoslash
import { os } from '@orpc/server'

declare const db: Map<string, unknown>
// ---cut---
interface ORPCMetadata {
  cache?: boolean
}

const base = os
  .$meta<ORPCMetadata>({}) // require define initial context [!code highlight]
  .use(async ({ procedure, next, path }, input, output) => {
    if (!procedure['~orpc'].meta.cache) {
      return await next()
    }

    const cacheKey = path.join('/') + JSON.stringify(input)

    if (db.has(cacheKey)) {
      return output(db.get(cacheKey))
    }

    const result = await next()

    db.set(cacheKey, result.output)

    return result
  })

const example = base
  .meta({ cache: true }) // [!code highlight]
  .handler(() => {
    // Implement your procedure logic here
  })
```

:::info
The `.meta` can be called multiple times; each call [spread merges](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax) the new metadata with the existing metadata or the initial metadata.
:::
