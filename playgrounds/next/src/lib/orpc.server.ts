import { createRouterClient } from '@orpc/server'

import { messagePublisher } from '@/context'
import { router } from '@/routers'

globalThis.$client = createRouterClient(router, {
  context: { messagePublisher },
})
