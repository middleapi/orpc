import type { router } from '@/app/api/[...rest]/router'
import { createORPCClient } from '@orpc/client'
import { ORPCLink } from '@orpc/client/fetch'
import { createORPCReact } from '@orpc/react'

const orpcLink = new ORPCLink({
  url: 'http://localhost:3000/api',
  headers: () => ({
    Authorization: 'Bearer default-token',
  }),
})

export const orpcClient = createORPCClient<typeof router>(orpcLink)

export const { orpc, ORPCContext } = createORPCReact<typeof orpcClient>()
