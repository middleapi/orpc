# RPC Serializer

RPC Serializers handle the serialization and deserialization of data sent between the client and server. They allow you to support complex data types beyond plain JSON, such as `Date`, `BigInt`, `Set`, and even custom classes.

## Supported Data Types

`RPCSerializer` supports the following types by default:

| Type                             | Handler key | Notes                                |
| -------------------------------- | ----------- | ------------------------------------ |
| **string**                       |             |                                      |
| **number**                       |             |                                      |
| **NaN**                          | `nan`       |                                      |
| **boolean**                      |             |                                      |
| **null**                         |             |                                      |
| **undefined**                    | `undefined` | Ignore `undefined` properties        |
| **Date**                         | `date`      | Includes `Invalid Date`.             |
| **BigInt**                       | `bigint`    |                                      |
| **RegExp**                       | `regexp`    |                                      |
| **URL**                          | `url`       |                                      |
| **Record (object)**              |             | `toJSON` methods are ignored         |
| **Array**                        |             |                                      |
| **Set**                          | `set`       |                                      |
| **Map**                          | `map`       |                                      |
| **Blob**                         |             | Unsupported in `AsyncIteratorObject` |
| **File**                         |             | Unsupported in `AsyncIteratorObject` |
| **AsyncIteratorObject**          |             | Only at the root level               |
| **ReadableStream\<Uint8Array\>** |             | Only at the root level               |

<!--@include: @/shared/standard-server-cors-warning.md -->

## Custom Serializers

Add custom handlers with unique keys to support additional types, or reuse a built-in key to override the default behavior.

```ts twoslash
class Person {
  constructor(
    public name: string,
    public age: number,
  ) {}
}
// ---cut---
import { RPCSerializer } from '@orpc/client'

const serializer = new RPCSerializer({
  handlers: {
    person: { // <- add support for Person
      condition: v => v instanceof Person,
      serialize: (v: Person) => ({ name: v.name, age: v.age }),
      deserialize: v => new Person(v.name, v.age),
    },
    date: { // <- replace the default Date handler
      condition: v => v instanceof Date,
      serialize: (v: Date) => v.getTime(),
      deserialize: v => new Date(v),
    },
  },
})
```

::: info Use a custom serializer with RPCHandler and RPCLink

```ts
const handler = new RPCHandler(router, {
  serializer,
})

const link = new RPCLink({
  serializer,
})
```

:::

## Serialization Format

In most cases, serialized data includes two optional fields: `json` and `meta`. `json` contains JSON-serializable data. `meta` contains the metadata needed to deserialize values.

::: info
`meta` is stored in the format `[handler: string, ...path: (string | number)[]]`.

- **handler**: The handler key used for serialization (see [Supported Data Types](#supported-data-types)).
- **path**: Path to the value inside `json`.

:::

```json
{
  "json": {
    "name": "John",
    "age": 30,
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "meta": [
    ["date", "createdAt"]
  ]
}
```

### With Files

If the data includes `Blob` or `File`, the serializer returns a `FormData` object. The `data` field contains a JSON string with `json`, `meta`, and `maps`, and the remaining fields contain the file parts.

::: info
`maps` is stored in the format `[...path: (string | number)[]]`, and its order corresponds to the file parts in the `FormData`.

For example, `[['thumbnail'], ['images', 0]]` means the first file part corresponds to `json.thumbnail` at `form.get('0')`, and the second file part corresponds to `json.images[0]` at `form.get('1')`.
:::

```ts
const form = new FormData()

form.set('data', JSON.stringify({
  json: {
    name: 'Earth',
    thumbnail: {},
    images: [{}],
    createdAt: '2022-01-01T00:00:00.000Z'
  },
  meta: [['date', 'createdAt']],
  maps: [['thumbnail'], ['images', 0]]
}))

form.set('0', new Blob([''], { type: 'image/png' }))
form.set('1', new Blob([''], { type: 'image/png' }))
```

### Direct File

If the entire data is a single `Blob` or `File`, it can be sent as-is without wrapping in `FormData`.

```http
HTTP/1.1 200 OK
Content-Type: image/png
Content-Disposition: attachment; filename="earth.png"
Content-Length: 12345
Standard-Server: file

<binary data>
```

::: info
If the receiver mistakenly handles this payload as a regular (non-file) body, set the `standard-server` header to help the receiver detect the actual data type and handle it correctly. Learn more about this header in the [Standard Server Documentation](https://github.com/middleapi/standardserver#resolving-body).
:::

### AsyncIteratorObject

When the output is an `AsyncIteratorObject`, it is sent as a [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream. Each event contains one serialized chunk of data.

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

event: message
data: {"json":{"name":"John","createdAt":"2024-01-01T00:00:00.000Z"},"meta":[["date","createdAt"]]}

event: message
data: {"json":{"name":"Jane","createdAt":"2024-01-02T00:00:00.000Z"},"meta":[["date","createdAt"]]}
```

### ReadableStream\<Uint8Array\>

A `ReadableStream<Uint8Array>` is passed through as-is and streamed as binary data.

```http
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Standard-Server: octet-stream

<binary chunk 1>
<binary chunk 2>
```

::: info
If the receiver mistakenly handles this payload as a regular (non-stream) body, set the `standard-server` header to help the receiver detect the actual data type and handle it correctly. Learn more about this header in the [Standard Server Documentation](https://github.com/middleapi/standardserver#resolving-body).
:::

## Learn More

The serializer is a small, self-contained module, making it easy to understand.
To explore its behavior in detail, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/client/src/rpc-serializer.ts).
