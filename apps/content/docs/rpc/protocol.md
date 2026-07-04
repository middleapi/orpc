# RPC Protocol

The RPC protocol is a lightweight protocol for remote procedure calls. It supports more native types than plain JSON and is used by [RPC Handler](/docs/rpc/handler) and [RPC Link](/docs/rpc/link).

## Serializer

Most of the protocol's flexibility comes from its serializer. In addition to JSON-compatible values, it supports native types such as `Date`, `BigInt`, `RegExp`, `URL`, `Set`, `Map`, `Blob`, `File`, `AsyncIteratorObject`, and `ReadableStream<Uint8Array>`. To learn more, including how to extend it, see [RPC Serializer](/docs/rpc/serializer).

<!--@include: @/shared/standard-server-cors-warning.md -->

## Routing

The request `pathname` identifies which procedure to call.

```bash
curl https://example.com/rpc/planet/create
```

This calls the `planet.create` procedure when `/rpc` is the prefix:

```ts
const router = {
  planet: {
    create: os.handler(() => {}) // [!code highlight]
  }
}
```

## Sending Input

You can use any HTTP method. Send input in the query string or request body, depending on the method.

::: info
Request payloads depend on the serializer and are not plain JSON. Learn more in [RPC Serializer Format](/docs/rpc/serializer#serialization-format).
:::

### Query String

```ts
const url = new URL('https://example.com/rpc/planet/create')

url.searchParams.append('data', JSON.stringify({
  json: {
    name: 'Earth',
    detached_at: '2022-01-01T00:00:00.000Z'
  },
  meta: [['date', 'detached_at']]
}))

const response = await fetch(url)
```

### Request Body

```bash
curl -X POST https://example.com/rpc/planet/create \
  -H 'Content-Type: application/json' \
  -d '{
    "json": {
      "name": "Earth",
      "detached_at": "2022-01-01T00:00:00.000Z"
    },
    "meta": [["date", "detached_at"]]
  }'
```

### With Files

```ts
const form = new FormData()

form.set('data', JSON.stringify({
  json: {
    name: 'Earth',
    thumbnail: {},
    images: [{}],
  },
  maps: [['thumbnail'], ['images', 0]]
}))

form.set('0', new Blob([''], { type: 'image/png' }))
form.set('1', new Blob([''], { type: 'image/png' }))

const response = await fetch('https://example.com/rpc/planet/create', {
  method: 'POST',
  body: form
})
```

## Success Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "json": {
    "id": "1",
    "name": "Earth",
    "detached_at": "2022-01-01T00:00:00.000Z"
  },
  "meta": [["bigint", "id"], ["date", "detached_at"]]
}
```

A successful response should use an HTTP status code in the `2xx` range (must be less than `400`) and return the procedure output.

::: info
Response bodies depend on the serializer and are not plain JSON. Learn more in [RPC Serializer Format](/docs/rpc/serializer#serialization-format).
:::

## Error Response

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "json": {
    "defined": false,
    "inferable": false,
    "code": "INTERNAL_SERVER_ERROR",
    "message": "Internal server error",
    "data": {
      "id": "1234567890"
    }
  },
  "meta": [["bigint", "data", "id"]]
}
```

An error response should use an HTTP status code in the `4xx` or `5xx` range (must be greater than or equal to `400`) and return an [ORPCError](/docs/rpc/error) object.

::: info
Response bodies depend on the serializer and are not plain JSON. Learn more in [RPC Serializer Format](/docs/rpc/serializer#serialization-format).
:::
