import { os, type } from '@orpc/server'

// @ts-expect-error the module does not exist
import type { Missing } from '@/missing'

export const router = {
  ok: os.handler(() => 'ok'),
  broken: os.input(type<Missing>()).handler(() => 1),
}
