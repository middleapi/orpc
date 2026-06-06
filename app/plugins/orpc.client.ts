import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { orpcContract } from '#shared/orpc-contract'

// To test the UI over RPC instead of REST, replace the OpenAPILink/client block
// below with:
//
// import type { RouterClient } from '@orpc/server'
// import type { router } from '../../server/routers'
// import { RPCLink } from '@orpc/client/fetch'
//
// const link = new RPCLink({
//   url: `${window.location.origin}/rpc`,
//   headers: () => ({}),
// })
//
// const client: RouterClient<typeof router> = createORPCClient(link)

export default defineNuxtPlugin(() => {
  const link = new OpenAPILink(orpcContract, {
    url: `${window.location.origin}/api`,
    headers: () => ({})
  })

  const client = createORPCClient<JsonifiedClient<ContractRouterClient<typeof orpcContract>>>(link)

  const orpc = createTanstackQueryUtils(client)

  return {
    provide: {
      orpc
    }
  }
})
