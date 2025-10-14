import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/message-port'
import type { RouterClient } from '@orpc/server'
import Worker from './worker?worker'
import type { router } from './worker'

export function getWorkerClient() {
  const link = new RPCLink({
    port: new Worker(),
  })

  return createORPCClient(link) as RouterClient<typeof router>
}
