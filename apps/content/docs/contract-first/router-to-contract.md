---
title: Router to Contract
description: Learn how to convert a router into a contract, safely export it, and prevent exposing internal details to the client.
---

# Router to Contract

A normal [router](/docs/router) works as a contract router as long as it does not include a [lazy router](/docs/router#lazy-router). This guide not only shows you how to **unlazy** a router to make it compatible with contracts, but also how to **minify** it and **prevent internal business logic from being exposed to the client**.

## Unlazy the Router

If your router includes a [lazy router](/docs/router#lazy-router), you need to fully resolve it to make it compatible with contract.

```ts
import { unlazyRouter } from '@orpc/server'

const resolvedRouter = await unlazyRouter(router)
```

## Minify & Export the Contract Router for the Client

Sometimes, you'll need to import the contract on the client - for example, to use [OpenAPILink](/docs/openapi/client/openapi-link) or define request methods in [RPCLink](/docs/client/rpc-link#custom-request-method).

If you're using [Contract First](/docs/contract-first/define-contract), this is safe: your contract is already lightweight and free of business logic.

However, if you're deriving the contract from a [router](/docs/router), importing it directly can be heavy and may leak internal logic. To prevent this, follow the steps below to safely minify and export your contract.

1.  **Minify the Contract Router and Export to JSON**

    ```ts
    import fs from 'node:fs'
    import { minifyContractRouter } from '@orpc/contract'

    const minifiedRouter = minifyContractRouter(router)

    fs.writeFileSync('./contract.json', JSON.stringify(minifiedRouter))
    ```

    ::: warning
    `minifyContractRouter` preserves only the metadata and routing information necessary for the client, all other data will be stripped out.
    :::

2.  **Import the Contract JSON on the Client Side**

    ```ts
    import contract from './contract.json' // [!code highlight]

    const link = new OpenAPILink(contract as typeof router, {
      url: 'http://localhost:3000/api',
    })
    ```

    ::: warning
    Cast `contract` to `typeof router` to ensure type safety, since standard schema types cannot be serialized to JSON so we must manually cast them.
    :::
