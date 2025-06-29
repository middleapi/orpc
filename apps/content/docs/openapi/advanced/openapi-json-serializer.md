---
title: OpenAPI JSON Serializer
description: Extend or override the standard OpenAPI JSON serializer.
---

# OpenAPI JSON Serializer

This serializer processes JSON payloads for the [OpenAPIHandler](/docs/openapi/openapi-handler) and supports [native data types](/docs/openapi/openapi-handler#supported-data-types).

## Extending Native Data Types

Customize serialization by creating your own `StandardOpenAPICustomJsonSerializer` and adding it to the `customJsonSerializers` option.

1. **Define Your Custom Serializer**

   ```ts twoslash
   import type { StandardOpenAPICustomJsonSerializer } from '@orpc/openapi-client/standard'

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

   export const userSerializer: StandardOpenAPICustomJsonSerializer = {
     condition: data => data instanceof User,
     serialize: data => data.toJSON(),
   }
   ```

2. **Use Your Custom Serializer**

   ```ts twoslash
   import type { StandardOpenAPICustomJsonSerializer } from '@orpc/openapi-client/standard'
   import { OpenAPIHandler } from '@orpc/openapi/fetch'
   import { OpenAPIGenerator } from '@orpc/openapi'

   declare const router: Record<never, never>
   declare const userSerializer: StandardOpenAPICustomJsonSerializer
   // ---cut---
   const handler = new OpenAPIHandler(router, {
     customJsonSerializers: [userSerializer],
   })

   const generator = new OpenAPIGenerator({
     customJsonSerializers: [userSerializer],
   })
   ```

   ::: info
   It is recommended to add custom serializers to the `OpenAPIGenerator` for consistent serialization in the OpenAPI document.
   :::
