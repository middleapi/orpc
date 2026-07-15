import { bench, describe } from 'vitest'
import z from 'zod'
import { os } from '../src/builder'
import { createRouterClient } from '../src/router-client'

/**
 * Benchmarks the server-side procedure call path: resolving the client,
 * running middlewares, validating input/output with a schema and invoking the
 * handler. This is the hot path executed for every incoming request.
 */

const InputSchema = z.object({
  id: z.number(),
  name: z.string(),
  tags: z.array(z.string()),
})

const OutputSchema = z.object({
  id: z.number(),
  name: z.string(),
  upper: z.string(),
  tagCount: z.number(),
})

const authMiddleware = os.middleware(async ({ next }) => next())
const logMiddleware = os.middleware(async ({ next }) => next())

const router = {
  simple: os
    .handler(() => 'pong'),
  validated: os
    .input(InputSchema)
    .output(OutputSchema)
    .handler(({ input }) => ({
      id: input.id,
      name: input.name,
      upper: input.name.toUpperCase(),
      tagCount: input.tags.length,
    })),
  withMiddlewares: os
    .use(authMiddleware)
    .use(logMiddleware)
    .input(InputSchema)
    .output(OutputSchema)
    .handler(({ input }) => ({
      id: input.id,
      name: input.name,
      upper: input.name.toUpperCase(),
      tagCount: input.tags.length,
    })),
}

const client = createRouterClient(router)

const validInput = {
  id: 1,
  name: 'orpc',
  tags: ['rpc', 'typescript', 'fast'],
}

describe('procedure call', () => {
  bench('simple handler (no schema)', async () => {
    await client.simple()
  })

  bench('validated input + output', async () => {
    await client.validated(validInput)
  })

  bench('validated + two middlewares', async () => {
    await client.withMiddlewares(validInput)
  })
})
