import { call, createProcedureClient, os, type } from '@orpc/server'
import { bench } from 'vitest'

/**
 * Benchmarks the server-side procedure call path in isolation:
 * pure handlers, validation (via `type` — no external schema libs),
 * middlewares, and mixed complex procedures.
 *
 * Compares pre-created clients vs the one-shot `call` utility so results
 * reflect oRPC overhead only, not Zod/Valibot/etc.
 */

interface Input {
  id: number
  name: string
  tags: string[]
}

interface Output {
  id: number
  name: string
  upper: string
  tagCount: number
}

const InputSchema = type<Input>()
const OutputSchema = type<Output>()

const validInput: Input = {
  id: 1,
  name: 'orpc',
  tags: ['rpc', 'typescript', 'fast'],
}

const authMiddleware = os.middleware(async ({ next }) => {
  return next({ context: { userId: 'user-1' } })
})

const logMiddleware = os.middleware(async ({ next }) => {
  return next()
})

const timingMiddleware = os.middleware(async ({ next }) => {
  return next({ context: { startedAt: 0 } })
})

function mapInput(input: Input): Output {
  return {
    id: input.id,
    name: input.name,
    upper: input.name.toUpperCase(),
    tagCount: input.tags.length,
  }
}

const pureProcedure = os.handler(() => 'pong')

const validationProcedure = os
  .input(InputSchema)
  .output(OutputSchema)
  .handler(({ input }) => mapInput(input))

const middlewareProcedure = os
  .use(authMiddleware)
  .use(logMiddleware)
  .handler(() => 'pong')

const mixedProcedure = os
  .use(authMiddleware)
  .use(logMiddleware)
  .use(timingMiddleware)
  .input(InputSchema)
  .output(OutputSchema)
  .handler(({ input }) => mapInput(input))

const pureClient = createProcedureClient(pureProcedure)
const validationClient = createProcedureClient(validationProcedure)
const middlewareClient = createProcedureClient(middlewareProcedure)
const mixedClient = createProcedureClient(mixedProcedure)

describe('procedure call', () => {
  bench('pre-created client: pure procedure', async () => {
    await pureClient()
  })

  bench('pre-created client: procedure with validations', async () => {
    await validationClient(validInput)
  })

  bench('pre-created client: procedure with middlewares', async () => {
    await middlewareClient()
  })

  bench('pre-created client: mixed procedure', async () => {
    await mixedClient(validInput)
  })

  bench('call util: pure procedure', async () => {
    await call(pureProcedure)
  })

  bench('call util: procedure with validations', async () => {
    await call(validationProcedure, validInput)
  })

  bench('call util: procedure with middlewares', async () => {
    await call(middlewareProcedure)
  })

  bench('call util: mixed procedure', async () => {
    await call(mixedProcedure, validInput)
  })
})
