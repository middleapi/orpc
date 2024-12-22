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

# @oRPC/contract

---

## Documentation

You can find the @orpc/contract documentation [here](https://orpc.unnoq.com/docs/server/contract).

---

## Installation

```bash
npm install @orpc/contract
pnpm install @orpc/contract
yarn add @orpc/contract
bun add @orpc/contract
```

---

## Example

```ts
import { oc } from '@orpc/contract'
import { z } from 'zod'

export const contract = oc.router({
  getUser: oc
    .route({
      path: '/{id}',
      method: 'GET',
    })
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        username: z.string(),
      }),
    ),
})
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
