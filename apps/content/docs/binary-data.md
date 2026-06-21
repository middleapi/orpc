# Binary Data

[File](https://developer.mozilla.org/en-US/docs/Web/API/File), [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob), and [ReadableStream\<Uint8Array\>](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) are supported by the [RPC Serializer](/docs/rpc/serializer) and [OpenAPI Serializer](/docs/openapi/serializer). Use them to handle binary data in your procedures.

<!--@include: @/shared/standard-server-cors-warning.md -->

## `File` and `Blob`

Procedures can accept `File` and `Blob` as input and return them directly or inside nested structures.

::: warning
`File` and `Blob` are usually buffered in memory by default. For large files, we recommend [extending the body parser](/docs/advanced/extend-body-parser) for better performance and reliability.
:::

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'
// ---cut---
const example = os
  .input(z.file())
  .output(z.object({ anyFieldName: z.instanceof(File) }))
  .handler(async ({ input }) => {
    const file = input

    console.log(file.name)

    return {
      anyFieldName: new File(['Hello World'], 'hello.txt', { type: 'text/plain' }),
    }
  })
```

## `ReadableStream<Uint8Array>`

Procedures can return `ReadableStream<Uint8Array>` to stream binary responses. The example below uses the [Response Headers Plugin](/docs/plugins/response-headers) to set the appropriate `Content-Type` header.

```ts twoslash
import { os } from '@orpc/server'
import { ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import * as z from 'zod'

interface ServerContext extends ResponseHeadersHandlerPluginContext {}

const base = os.$context<ServerContext>()
// ---cut---
const example = base
  .output(z.instanceof(ReadableStream))
  .handler(async ({ context }) => {
    context.resHeaders?.set('Content-Type', 'text/plain')

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Hello World'))
        controller.close()
      }
    })

    return stream
  })
```
