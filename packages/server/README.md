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

# @oRPC/server

---

## Documentation

You can find the @orpc/server documentation [here](https://orpc.unnoq.com/docs/server/procedure).

---

## Installation

```bash
npm install @orpc/server
pnpm install @orpc/server
yarn add @orpc/server
bun add @orpc/server
```

---

## Example

```ts
import { os } from '@orpc/server'
import { contract } from './contract'

export type Context = { user?: { id: string } }
export const base = os.context<Context>()
export const publicRouter = base.contract(contract)

export const router = publicRouter.router({
  getUser: publicRouter.getUser.func(async (input, context, meta) => {
    return {
      id: '1234567890',
      username: 'david',
    }
  }),
})
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
