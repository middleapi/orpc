import { implement } from '@orpc/server'
import { dbProviderMiddleware } from './middlewares/db'
import { contract } from './contract'
import { authMiddleware } from './middlewares/auth'

export const pub = implement(contract)
  .use(dbProviderMiddleware)

export const authed = pub
  .use(authMiddleware)
