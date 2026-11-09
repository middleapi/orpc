import { os } from '@orpc/server'

/** A project the solution does not reference */
export const router = {
  ping: os.handler(() => ({ ok: true })),
}
