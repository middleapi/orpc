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

# @oRPC/react

---

## Documentation

You can find the @orpc/react documentation [here](https://orpc.unnoq.com/docs/client/react).

---

## Installation

```bash
npm install @orpc/react
pnpm install @orpc/react
yarn add @orpc/react
bun add @orpc/react
```

---

## Example

#### `provider.tsx`

```tsx
import type { router } from './server'
import { createORPCFetchClient } from '@orpc/client'
import { createORPCReact } from '@orpc/react'
import { RouterClient } from '@orpc/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import * as React from 'react'

export const { orpc, ORPCContext } = createORPCReact<RouterClient<typeof router /** or contract router */>>()

export function ORPCProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createORPCFetchClient<typeof router /** must match with createORPCReact */>({
    baseURL: 'http://localhost:3000/api',
  }))
  const [queryClient] = useState(() => new QueryClient())

  const contextValue = React.useMemo(() => ({ client, queryClient }), [client, queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <ORPCContext.Provider value={contextValue}>
        {/* If you has own QueryClientProvider please put it here */}
        {children}
      </ORPCContext.Provider>
    </QueryClientProvider>
  )
}
```

#### `component.tsx`

```tsx
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { orpc } from './provider'

function useUserInfo(): React.ReactNode {
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
