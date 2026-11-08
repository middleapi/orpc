import { oc, type } from '@orpc/contract'
import { implement } from '@orpc/server'

export interface User {
  id: string
  name: string
}

export const contract = {
  users: {
    /**
     * Get a user
     * Looks a user up by id.
     * @tags users
     */
    get: oc.input(type<{ id: string }>()).output(type<User>()),
    /** List users */
    list: oc.output(type<User[]>()),
  },
}

export const impl = implement(contract)
