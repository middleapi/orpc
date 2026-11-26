import { os, type } from '@orpc/server'

import type { User as UserA } from './released-names/a'
import type { User as UserB } from './released-names/b'

// declared apart from the two `User`s, with the same fields
export interface User2 {
  id: string
}

/** The second `User` is named `User2` until it shares the def of the first */
export const releasedNames = {
  a: os.output(type<UserA>()).handler(() => ({ id: '1' })),
  b: os.output(type<UserB>()).handler(() => ({ id: '1' })),
  c: os.output(type<User2>()).handler(() => ({ id: '1' })),
}
