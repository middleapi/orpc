import { os } from '@orpc/server'

import type { Account } from '@/account'

export const router = {
  account: os.handler((): Account => ({ id: '1' })),
}
