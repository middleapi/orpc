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

# @oRPC/client

---

## Documentation

You can find the @orpc/client documentation [here](https://orpc.unnoq.com/docs/client/vanilla).

---

## Installation

```bash
npm install @orpc/client
pnpm install @orpc/client
yarn add @orpc/client
bun add @orpc/client
```

---

## Example

```tsx
import type { contract } from 'examples/server'
import { createORPCFetchClient, ORPCError } from '@orpc/client'

const client = createORPCFetchClient<typeof contract>({
  baseURL: 'http://localhost:3000/api',
  // fetch: optional override for the default fetch function
  // headers: provide additional headers
})

const output = await client.post.create({
  title: 'My Amazing Title',
  description: 'This is a detailed description of my content',
})
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
