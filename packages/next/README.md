<div align="center">
  <image align="center" src="https://i.ibb.co/rZw671M/New-Project-2.png" width=400 />
</div>

<h1></h1>

<div align="center">

![NPM Downloads](https://img.shields.io/npm/dm/%40orpc/server?logo=npm)
![GitHub Release](https://img.shields.io/github/v/release/unnoq/orpc?logo=github)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/unnoq/orpc?logo=git&logoColor=%23fff)
![GitHub License](https://img.shields.io/github/license/unnoq/orpc)

</div>

> This project is still in heavy development, please be mindful of breaking changes.

# @oRPC/next

---

## Documentation

You can find the @orpc/next documentation [here](https://orpc.unnoq.com/docs/server/integrations#nextjs).

---

## Installation

```bash
npm install @orpc/next
pnpm install @orpc/next
yarn add @orpc/next
bun add @orpc/next
```

---

## Example

##### `app/api/[...orpc]/route.ts`

```ts
import { createOpenAPIServerHandler, createOpenAPIServerlessHandler } from '@orpc/openapi/fetch'
import { createORPCHandler, handleFetchRequest } from '@orpc/server/fetch'
import { router } from 'examples/server'

export function GET(request: Request) {
  return handleFetchRequest({
    router,
    request,
    prefix: '/api',
    context: {},
    handlers: [
      createORPCHandler(),
      createOpenAPIServerlessHandler(),
    ],
  })
}

export const POST = GET
export const PUT = GET
export const DELETE = GET
export const PATCH = GET
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
