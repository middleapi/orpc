# Base64Url Helpers

Base64Url helpers provide functions to encode and decode base64url strings, a URL-safe variant of base64 encoding used in web tokens, data serialization, and APIs.

## Basic Usage

```ts twoslash
import { decodeBase64url, encodeBase64url } from '@orpc/server/helpers'

const originalText = 'Hello World'
const textBytes = new TextEncoder().encode(originalText)
const encodedData = encodeBase64url(textBytes)
const decodedBytes = decodeBase64url(encodedData)
const decodedText = new TextDecoder().decode(decodedBytes) // 'Hello World'
```

::: info
The `decodeBase64url` accepts `undefined` or `null` as encoded value and returns `undefined` for invalid inputs, enabling seamless handling of optional data.
:::
