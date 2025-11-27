import { os } from '@orpc/server'
import { dbProviderMiddleware } from './middlewares/db'
import { requiredAuthMiddleware } from './middlewares/auth'
import type { Publisher } from '@orpc/experimental-publisher'

type ORPCContext = {
  env: Env
  messagePublisher: Publisher<Record<string, { message: string }>>
}

export const pub = os
  .$context<ORPCContext>()
  .use(dbProviderMiddleware)

export const authed = pub
  .use(requiredAuthMiddleware)
