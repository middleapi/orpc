import type { router } from '~/server/router'
import { createORPCClient } from '@orpc/client'
import { ORPCLink } from '@orpc/client/fetch'
import { createORPCVueQueryUtils } from '@orpc/vue-query'

const orpcLink = new ORPCLink({
  url: 'http://localhost:3000/api',
  headers: () => ({
    Authorization: 'Bearer default-token',
  }),
})

export const client = createORPCClient<typeof router>(orpcLink)

export const orpc = createORPCVueQueryUtils(client)
