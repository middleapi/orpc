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
//   url: `${requestURL.origin}/rpc`,
//   headers: () => headers,
// })
//
// const client: RouterClient<typeof router> = createORPCClient(link)

export default defineNuxtPlugin(() => {
  const requestURL = useRequestURL()
  const requestHeaders = useRequestHeaders()
  const headers = new Headers()

  for (const [key, value] of Object.entries(requestHeaders)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
  }

  const link = new OpenAPILink(orpcContract, {
    url: `${requestURL.origin}/api`,
    headers: () => headers
  })

  const client = createORPCClient<JsonifiedClient<ContractRouterClient<typeof orpcContract>>>(link)

  const orpc = createTanstackQueryUtils(client)

  return {
    provide: {
      orpc
    }
  }
})
