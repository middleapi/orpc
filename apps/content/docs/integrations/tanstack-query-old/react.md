---
title: Tanstack Query Integration For React
description: Seamlessly integrate oRPC with Tanstack Query for React
---

# Tanstack Query Integration For React

This guide shows how to integrate oRPC with Tanstack Query for React. For an introduction, please review the [Basic Guide](/docs/integrations/tanstack-query-old/basic) first.

## Installation

::: code-group

```sh [npm]
npm install @orpc/react-query@latest @tanstack/react-query@latest
```

```sh [yarn]
yarn add @orpc/react-query@latest @tanstack/react-query@latest
```

```sh [pnpm]
pnpm add @orpc/react-query@latest @tanstack/react-query@latest
```

```sh [bun]
bun add @orpc/react-query@latest @tanstack/react-query@latest
```

```sh [deno]
deno install npm:@orpc/react-query@latest npm:@tanstack/react-query@latest
```

:::

## Setup

Before you begin, ensure you have already configured a [server-side client](/docs/client/server-side) or a [client-side client](/docs/client/client-side).

```ts twoslash
import { router } from './shared/planet'
import { RouterClient } from '@orpc/server'

declare const client: RouterClient<typeof router>
// ---cut---
import { createORPCReactQueryUtils } from '@orpc/react-query'

export const orpc = createORPCReactQueryUtils(client)

orpc.planet.find.queryOptions({ input: { id: 123 } })
//               ^|

//
```

## Avoiding Query/Mutation Key Conflicts

Prevent key conflicts by passing a unique base key when creating your utils:

```ts
const userORPC = createORPCReactQueryUtils(userClient, {
  path: ['user']
})
const postORPC = createORPCReactQueryUtils(postClient, {
  path: ['post']
})
```

## Using React Context

Integrate oRPC React Query utils into your React app with Context:

1. **Create the Context:**

   ```ts twoslash
   import { router } from './shared/planet'
   // ---cut---
   import { createContext, use } from 'react'
   import { RouterUtils } from '@orpc/react-query'
   import { RouterClient } from '@orpc/server'

   type ORPCReactUtils = RouterUtils<RouterClient<typeof router>>

   export const ORPCContext = createContext<ORPCReactUtils | undefined>(undefined)

   export function useORPC(): ORPCReactUtils {
     const orpc = use(ORPCContext)
     if (!orpc) {
       throw new Error('ORPCContext is not set up properly')
     }
     return orpc
   }
   ```

2. **Provide the Context in Your App:**

   ```tsx
   export function App() {
     const [client] = useState<RouterClient<typeof router>>(() => createORPCClient(link))
     const [orpc] = useState(() => createORPCReactQueryUtils(client))

     return (
       <ORPCContext.Provider value={orpc}>
         <YourApp />
       </ORPCContext.Provider>
     )
   }
   ```

3. **Use the Utils in Components:**

   ```ts twoslash
   import { router } from './shared/planet'
   import { RouterClient } from '@orpc/server'
   import { RouterUtils } from '@orpc/react-query'
   import { useQuery } from '@tanstack/react-query'

   declare function useORPC(): RouterUtils<RouterClient<typeof router>>
   // ---cut---
   const orpc = useORPC()

   const query = useQuery(orpc.planet.find.queryOptions({ input: { id: 123 } }))
   ```
