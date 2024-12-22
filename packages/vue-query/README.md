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

# @oRPC/vue-query

---

## Documentation

You can find the @orpc/vue-query documentation [here](https://orpc.unnoq.com/docs/client/vue-query).

---

## Installation

```bash
npm install @orpc/vue-query
pnpm install @orpc/vue-query
yarn add @orpc/vue-query
bun add @orpc/vue-query
```

---

## Example

#### `client.ts`

```tsx
import type { router } from './server'
import { createORPCFetchClient } from '@orpc/client'
import { createORPCVueQueryUtils } from '@orpc/vue-query'

// Create an ORPC client
export const client = createORPCFetchClient<typeof router>({
  baseURL: 'http://localhost:3000/api',
})

// Create Vue Query utilities for ORPC
export const orpc = createORPCVueQueryUtils(client)
```

#### `component.tsx`

```tsx
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/vue-query'
import { orpc } from './provider'

function useUserInfo(): vue.vueNode {
  const { data: gettingData } = useQuery(orpc.getUser.queryOptions({
    input: {
      id: 'david'
    }
  }))
}
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
