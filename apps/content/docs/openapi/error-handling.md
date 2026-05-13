---
title: OpenAPI Error Handling
description: Handle errors in your OpenAPI-compliant oRPC APIs
---

# OpenAPI Error Handling

Before you begin, please review our [Error Handling](/docs/error-handling) guide. This document shows you how to align your error responses with OpenAPI standards.

## Default Error Mappings

By default, oRPC maps common error codes to standard HTTP status codes:

| Error Code             | HTTP Status Code | Message                |
| ---------------------- | ---------------: | ---------------------- |
| BAD_REQUEST            |              400 | Bad Request            |
| UNAUTHORIZED           |              401 | Unauthorized           |
| FORBIDDEN              |              403 | Forbidden              |
| NOT_FOUND              |              404 | Not Found              |
| METHOD_NOT_SUPPORTED   |              405 | Method Not Supported   |
| NOT_ACCEPTABLE         |              406 | Not Acceptable         |
| TIMEOUT                |              408 | Request Timeout        |
| CONFLICT               |              409 | Conflict               |
| GONE                   |              410 | Gone                   |
| PRECONDITION_FAILED    |              412 | Precondition Failed    |
| PAYLOAD_TOO_LARGE      |              413 | Payload Too Large      |
| UNSUPPORTED_MEDIA_TYPE |              415 | Unsupported Media Type |
| UNPROCESSABLE_CONTENT  |              422 | Unprocessable Content  |
| TOO_MANY_REQUESTS      |              429 | Too Many Requests      |
| CLIENT_CLOSED_REQUEST  |              499 | Client Closed Request  |
| INTERNAL_SERVER_ERROR  |              500 | Internal Server Error  |
| NOT_IMPLEMENTED        |              501 | Not Implemented        |
| BAD_GATEWAY            |              502 | Bad Gateway            |
| SERVICE_UNAVAILABLE    |              503 | Service Unavailable    |
| GATEWAY_TIMEOUT        |              504 | Gateway Timeout        |

Any error not defined above defaults to HTTP status `500` with the error code used as the message.

## Customizing Errors

You can override the default mappings by specifying a custom `status` and `message` when creating an error:

```ts
const example = os
  .errors({
    RANDOM_ERROR: {
      status: 503, // <-- override default status
      message: 'Default error message', // <-- override default message
    },
  })
  .handler(() => {
    throw new ORPCError('ANOTHER_RANDOM_ERROR', {
      status: 502, // <-- override default status
      message: 'Custom error message', // <-- override default message
    })
  })
```
