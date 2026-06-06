import type { z } from 'zod'
import type { UserSchema } from './schemas/user'
import { implement, ORPCError } from '@orpc/server'
import { orpcContract } from '#shared/orpc-contract'
import { dbProviderMiddleware } from './middlewares/db'

export interface ORPCContext {
  headers?: Headers
  user?: z.infer<typeof UserSchema>
}

export const orpc = implement(orpcContract)
  .$context<ORPCContext>()

export const pub = orpc
  .use(dbProviderMiddleware)

export const authed = pub.use(({ context, next }) => {
  if (!context.user) {
    throw new ORPCError('UNAUTHORIZED')
  }

  return next({
    context: {
      user: context.user
    }
  })
})
