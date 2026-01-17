import { implement } from '@orpc/server'
import { contract } from '../contract'
import type { UserSchema } from '../schemas/user'
import type { z } from 'zod'

export interface AuthContext {
  user?: z.infer<typeof UserSchema>
}

export const authMiddleware = implement(contract)
  .$context<AuthContext>()
  .middleware(({ context, next, errors }) => {
    /**
     * Type narrowing check for error constructor access.
     * Required when not all procedures in the contract define this error.
     */
    if (!('UNAUTHORIZED' in errors)) {
      throw new Error('Contract is missing UNAUTHORIZED error')
    }

    if (!context.user) {
      throw errors.UNAUTHORIZED()
    }

    return next({
      context: {
        user: context.user,
      },
    })
  })
