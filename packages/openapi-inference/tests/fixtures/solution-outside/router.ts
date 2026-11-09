import { os } from '@orpc/server'

/** A referenced project outside the solution's directory */
export const router = {
  pong: os.handler(() => ({ label: 'x' })),
}
