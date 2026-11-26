import { os } from '@orpc/server'

export const router = {
  headers: os.handler((): { headers: Record<`x-${string}`, string> } => ({ headers: {} })),
}
