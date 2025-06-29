---
title: RPC JSON Serializer
description: Extend or override the standard RPC JSON serializer.
---

# RPC JSON Serializer

This serializer handles JSON payloads for the [RPC Protocol](/docs/advanced/rpc-protocol) and supports [native data types](/docs/rpc-handler#supported-data-types).

## Extending Native Data Types

Extend native types by creating your own `StandardRPCCustomJsonSerializer` and adding it to the `customJsonSerializers` option.

1. **Define Your Custom Serializer**

   ```ts twoslash
   import type { StandardRPCCustomJsonSerializer } from '@orpc/client/standard'

   export class User {
     constructor(
       public readonly id: string,
       public readonly name: string,
       public readonly email: string,
       public readonly age: number,
     ) {}

     toJSON() {
       return {
         id: this.id,
         name: this.name,
         email: this.email,
         age: this.age,
       }
     }
   }

   export const userSerializer: StandardRPCCustomJsonSerializer = {
     type: 21,
     condition: data => data instanceof User,
     serialize: data => data.toJSON(),
     deserialize: data => new User(data.id, data.name, data.email, data.age),
   }
   ```

   ::: warning
   Ensure the `type` is unique and greater than `20` to avoid conflicts with [built-in types](/docs/advanced/rpc-protocol#supported-types) in the future.
   :::

2. **Use Your Custom Serializer**

   ```ts twoslash
   import type { StandardRPCCustomJsonSerializer } from '@orpc/client/standard'
   import { RPCHandler } from '@orpc/server/fetch'
   import { RPCLink } from '@orpc/client/fetch'

   declare const router: Record<never, never>
   declare const userSerializer: StandardRPCCustomJsonSerializer
   // ---cut---
   const handler = new RPCHandler(router, {
     customJsonSerializers: [userSerializer], // [!code highlight]
   })

   const link = new RPCLink({
     url: 'https://example.com/rpc',
     customJsonSerializers: [userSerializer], // [!code highlight]
   })
   ```

## Overriding Built-in Types

You can override built-in types by matching their `type` with the [built-in types](/docs/advanced/rpc-protocol#supported-types).

For example, oRPC represents `undefined` only in array items and ignores it in objects. To override this behavior:

```ts twoslash
import { StandardRPCCustomJsonSerializer } from '@orpc/client/standard'

export const undefinedSerializer: StandardRPCCustomJsonSerializer = {
  type: 3, // Match the built-in undefined type. [!code highlight]
  condition: data => data === undefined,
  serialize: data => null, // JSON cannot represent undefined, so use null.
  deserialize: data => undefined,
}
```
