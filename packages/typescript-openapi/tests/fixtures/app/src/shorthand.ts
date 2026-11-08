import { os } from '@orpc/server'

import { pong } from './routers/pong'

/** Ping it */
const ping = os.handler(() => 'ping')

export const router = {
  ping,
  pong,
  renamed: ping,
  /** Own JSDoc wins */
  overridden: ping,
}
