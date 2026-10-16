import '@orpc/experimental-effect/extensions/effect'
import '@orpc/experimental-effect/extensions/input-output'

import type { WithEffectContext } from '@orpc/experimental-effect'
import type { PlanetRepo } from './services'
import { middlewareGen } from '@orpc/experimental-effect'
import { os } from '@orpc/server'
import { Clock, Effect, Exit } from 'effect'

export interface ServerContext extends WithEffectContext<PlanetRepo> {}

export const base = os.$context<ServerContext>().use(middlewareGen(function* ({ path, next }) {
  const startedAt = yield* Clock.currentTimeMillis

  // Downstream failures land in the error channel of `next`, so this logs failed calls too.
  return yield* next().pipe(
    Effect.onExit(exit => Clock.currentTimeMillis.pipe(
      Effect.flatMap(finishedAt => Effect.logInfo(
        `${path.join('.')} ${Exit.isSuccess(exit) ? 'succeeded' : 'failed'} in ${finishedAt - startedAt}ms`,
      )),
    )),
  )
}))
