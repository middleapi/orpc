import type { RouterClient } from '@orpc/server'
import type { router } from './routers'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { catchORPCErrorCode, createEffectClient } from '@orpc/experimental-effect'
import { Effect } from 'effect'

const link = new RPCLink({
  url: '/rpc',
  origin: 'http://localhost:3000',
})

const client: RouterClient<typeof router> = createORPCClient(link)

const effectClient = createEffectClient(client)

const program = Effect.gen(function* () {
  const created = yield* effectClient.planet.create({ name: 'Pluto', description: 'A dwarf planet' })

  // Effects are lazy, so retrying re-sends the request.
  const planets = yield* effectClient.planet.list({ limit: 10 }).pipe(
    Effect.retry({ times: 2 }),
  )

  const missing = yield* effectClient.planet.find({ id: 'unknown' }).pipe(
    catchORPCErrorCode('NOT_FOUND', error => Effect.succeed(error.message)),
  )

  return { created, planets, missing }
}).pipe(
  // Interrupting the effect aborts the in-flight request.
  Effect.timeout('5 seconds'),
)

console.log(await Effect.runPromise(program))
