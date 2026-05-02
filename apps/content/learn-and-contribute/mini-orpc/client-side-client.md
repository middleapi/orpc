---
title: Client-side Client in Mini oRPC
description: Learn how to implement remote procedure calls (RPC) on the client side in Mini oRPC.
---

# Client-side Client in Mini oRPC

In Mini oRPC, the client-side client initiates remote procedure calls to the server. Both client and server must follow shared conventions to communicate effectively. While we could use the [RPC Protocol](/docs/advanced/rpc-protocol), we'll implement simpler conventions for clarity.

::: info
The complete Mini oRPC implementation is available in our GitHub repository: [Mini oRPC Repository](https://github.com/middleapi/mini-orpc)
:::

## Implementation

Here's the complete implementation of the [client-side client](/docs/client/client-side) functionality in Mini oRPC:

::: code-group

```ts [server/src/fetch/handler.ts]
import { ORPCError } from '@mini-orpc/client'
import { get, parseEmptyableJSON } from '@orpc/shared'
import { isProcedure } from '../procedure'
import { createProcedureClient } from '../procedure-client'
import type { Router } from '../router'
import type { Context } from '../types'

export interface JSONHandlerHandleOptions<T extends Context> {
  prefix?: `/${string}`
  context: T
}

export type JSONHandlerHandleResult
  = | { matched: true, response: Response }
    | { matched: false, response?: undefined }

export class RPCHandler<T extends Context> {
  private readonly router: Router<T>

  constructor(router: Router<T>) {
    this.router = router
  }

  async handle(
    request: Request,
    options: JSONHandlerHandleOptions<T>
  ): Promise<JSONHandlerHandleResult> {
    const prefix = options.prefix
    const url = new URL(request.url)

    if (
      prefix
      && !url.pathname.startsWith(`${prefix}/`)
      && url.pathname !== prefix
    ) {
      return { matched: false, response: undefined }
    }

    const pathname = prefix ? url.pathname.replace(prefix, '') : url.pathname

    const path = pathname
      .replace(/^\/|\/$/g, '')
      .split('/')
      .map(decodeURIComponent)

    const procedure = get(this.router, path)

    if (!isProcedure(procedure)) {
      return { matched: false, response: undefined }
    }

    const client = createProcedureClient(procedure, {
      context: options.context,
      path,
    })

    try {
      /**
       * The request body may be empty, which is interpreted as `undefined` input.
       * Only JSON data is supported for input transfer.
       * For more complex data types, consider using a library like [SuperJSON](https://github.com/flightcontrolhq/superjson).
       * Note: oRPC uses its own optimized serialization for internal transfers.
       */
      const input = parseEmptyableJSON(await request.text())

      const output = await client(input, {
        signal: request.signal,
      })

      const response = Response.json(output)

      return {
        matched: true,
        response,
      }
    }
    catch (e) {
      const error
        = e instanceof ORPCError
          ? e
          : new ORPCError('INTERNAL_ERROR', {
              message: 'An error occurred while processing the request.',
              cause: e,
            })

      const response = new Response(JSON.stringify(error.toJSON()), {
        status: error.status,
        headers: {
          'Content-Type': 'application/json',
        },
      })

      return {
        matched: true,
        response,
      }
    }
  }
}
```

```ts [client/src/fetch/link.ts]
import { parseEmptyableJSON } from '@orpc/shared'
import { isORPCErrorJson, isORPCErrorStatus, ORPCError } from '../error'
import type { ClientOptions } from '../types'

export interface JSONLinkOptions {
  url: string | URL
}

export class RPCLink {
  private readonly url: string | URL

  constructor(options: JSONLinkOptions) {
    this.url = options.url
  }

  async call(
    path: readonly string[],
    input: any,
    options: ClientOptions
  ): Promise<any> {
    const url = new URL(this.url)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.join('/')}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: options.signal,
    })

    /**
     * The request body may be empty, which is interpreted as `undefined` output/error.
     * Only JSON data is supported for output/error transfer.
     * For more complex data types, consider using a library like [SuperJSON](https://github.com/flightcontrolhq/superjson).
     * Note: oRPC uses its own optimized serialization for internal transfers.
     */
    const body = await parseEmptyableJSON(await response.text())

    if (isORPCErrorStatus(response.status) && isORPCErrorJson(body)) {
      throw new ORPCError(body.code, body)
    }

    if (!response.ok) {
      throw new Error(
        `[ORPC] Request failed with status ${response.status}: ${response.statusText}`,
        { cause: response }
      )
    }

    return body
  }
}
```

:::

## Type-Safe Wrapper

We can create a type-safe wrapper for easier client-side usage:

::: code-group

```ts [client/src/client.ts]
import type { RPCLink } from './fetch'
import type { Client, ClientOptions, NestedClient } from './types'

export interface createORPCClientOptions {
  /**
   * Base path for all procedures. Useful when calling only a subset of procedures.
   */
  path?: readonly string[]
}

/**
 * Create an oRPC client from a link.
 */
export function createORPCClient<T extends NestedClient>(
  link: RPCLink,
  options: createORPCClientOptions = {}
): T {
  const path = options.path ?? []

  const procedureClient: Client<unknown, unknown> = async (
    ...[input, clientOptions = {} as ClientOptions]
  ) => {
    return await link.call(path, input, clientOptions)
  }

  const recursive = new Proxy(procedureClient, {
    get(target, key) {
      if (typeof key !== 'string') {
        return Reflect.get(target, key)
      }

      return createORPCClient(link, {
        ...options,
        path: [...path, key],
      })
    },
  })

  return recursive as any
}
```

:::

## Usage

Simply set up a client and enjoy a server-side-like experience:

```ts
const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
})

export const orpc: RouterClient<typeof router> = createORPCClient(link)

const result = await orpc.someProcedure({ input: 'example' })
```
