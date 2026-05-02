import type { User } from '../schemas/user'
import { ORPCError, os } from '@orpc/server'

export const requiredAuthMiddleware = os
  .$context<{ session?: { user?: User } }>()
  .middleware(async ({ context, next }) => {
    /**
     * Why we should ?? here?
     * Because it can avoid `getSession` being called when unnecessary.
     * {@link https://orpc.dev/docs/best-practices/dedupe-middleware}
     */
    const session = context.session ?? await getSession()

    if (!session.user) {
      throw new ORPCError('UNAUTHORIZED')
    }

    return next({
      context: { user: session.user },
    })
  })

/**
 * Define the name of the middleware for better span naming and debugging.
 */
Object.defineProperty(requiredAuthMiddleware, 'name', {
  value: 'required_auth',
})

async function getSession() {
  return { user: { id: 'unique', name: 'Example', email: 'example@example.com' } }
}
