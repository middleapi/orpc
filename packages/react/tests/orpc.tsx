import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { ORPCLink } from '@orpc/client/fetch'
import { os } from '@orpc/server'
import { ORPCHandler } from '@orpc/server/fetch'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { Suspense } from 'react'
import { z } from 'zod'
import { createORPCReact } from '../src'

export const orpcServer = os

export const ping = orpcServer.handler(() => 'pong')

export const UserSchema = z
  .object({ data: z.object({ id: z.string(), name: z.string() }) })
  .transform(data => data.data)
export const UserFindInputSchema = z
  .object({ id: z.string() })
  .transform(data => ({ data }))

export const userFind = orpcServer
  .input(UserFindInputSchema)
  .output(UserSchema)
  .handler((input) => {
    return {
      data: {
        id: input.data.id,
        name: `name-${input.data.id}`,
      },
    }
  })

export const UserListInputSchema = z
  .object({
    keyword: z.string().optional(),
    cursor: z.number().default(0),
  })
  .transform(data => ({ data }))
export const UserListOutputSchema = z
  .object({
    data: z.object({
      nextCursor: z.number(),
      users: z.array(UserSchema),
    }),
  })
  .transform(data => data.data)
export const userList = orpcServer
  .input(UserListInputSchema)
  .output(UserListOutputSchema)
  .handler((input) => {
    return {
      data: {
        nextCursor: input.data.cursor + 2,
        users: [
          {
            data: {
              id: `id-${input.data.cursor}`,
              name: `number-${input.data.cursor}`,
            },
          },
          {
            data: {
              id: `id-${input.data.cursor + 1}`,
              name: `number-${input.data.cursor + 1}`,
            },
          },
        ],
      },
    }
  })

export const UserCreateInputSchema = z
  .object({ name: z.string() })
  .transform(data => ({ data }))
export const userCreate = orpcServer
  .input(UserCreateInputSchema)
  .output(UserSchema)
  .handler((input) => {
    return {
      data: {
        id: '28aa6286-48e9-4f23-adea-3486c86acd55',
        name: input.data.name,
      },
    }
  })

export const appRouter = orpcServer.router({
  ping,
  user: {
    find: userFind,
    list: userList,
    create: userCreate,
  },
})

const orpcHandler = new ORPCHandler(appRouter)

const orpcLink = new ORPCLink({
  url: 'http://localhost:3000',
  async fetch(input, init) {
    await new Promise(resolve => setTimeout(resolve, 100))
    const request = new Request(input, init)

    return orpcHandler.fetch(request)
  },
})

export const orpcClient = createORPCClient<typeof appRouter>(orpcLink)

export const { orpc, ORPCContext } = createORPCReact<RouterClient<typeof appRouter, unknown>>()

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError?: boolean, error: unknown }
> {
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }

  override render() {
    if (this.state?.hasError) {
      return (
        <div data-testid="error-boundary">
          Error occurred
          <pre>{JSON.stringify(this.state.error, null, 2)}</pre>
        </div>
      )
    }

    return this.props.children
  }
}

export function wrapper(props: { children: React.ReactNode }) {
  return (
    <ORPCContext.Provider value={{ client: orpcClient, queryClient }}>
      <QueryClientProvider client={queryClient}>
        {/* make sure orpc provide correct queryClient on each hook call */}
        <QueryClientProvider client={new QueryClient()}>
          <ErrorBoundary>
            <Suspense fallback={<div>Loading...</div>}>
              {props.children}
            </Suspense>
          </ErrorBoundary>
        </QueryClientProvider>
      </QueryClientProvider>
    </ORPCContext.Provider>
  )
}
