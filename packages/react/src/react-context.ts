import type { RouterClient } from '@orpc/server'
import type { QueryClient } from '@tanstack/react-query'
import { type Context, createContext, useContext } from 'react'

export interface ORPCContextValue<T extends RouterClient<any, any>> {
  client: T
  queryClient: QueryClient
}

export type ORPCContext<T extends RouterClient<any, any>> = Context<
  ORPCContextValue<T> | undefined
>

export function createORPCContext<T extends RouterClient<any, any>>(): ORPCContext<T> {
  return createContext(undefined as any)
}

export function useORPCContext<T extends RouterClient<any, any>>(
  context: ORPCContext<T>,
): ORPCContextValue<T> {
  const value = useContext(context)

  if (!value) {
    throw new Error(
      'useORPCContext must be used within a <ORPCContext.Provider>, please see the docs',
    )
  }

  return value
}
