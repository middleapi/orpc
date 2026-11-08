import { os } from '@orpc/server'

import { planetRouter } from './routers/planet'

export const router = {
  planet: planetRouter,
  stream: os.lazy(() => import('./routers/stream')),
  /** Health check */
  health: os.handler(() => ({ ok: true as const, uptime: 1, at: new Date() })),
  void: os.handler(() => {}),
}

export type AppRouter = typeof router
