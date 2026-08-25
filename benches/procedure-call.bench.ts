import { createProcedureClient, os, type } from '@orpc/server'
import { bench } from 'vitest'

const auth = os.middleware(async ({ next }) => {
  return next({ context: { userId: 'user-1' } })
})

const log = os.middleware(async ({ next }) => {
  return next()
})

const timing = os.middleware(async ({ next }) => {
  return next({ context: { startedAt: 0 } })
})

const plain = os.handler(({ input }) => input)

const validated = os
  .input(type<any>())
  .output(type<any>())
  .handler(({ input }) => input)

const middlewares = os
  .use(auth)
  .use(log)
  .use(timing)
  .handler(({ input }) => input)

const full = os
  .use(auth)
  .use(log)
  .use(timing)
  .input(type<any>())
  .output(type<any>())
  .handler(({ input }) => input)

const plainClient = createProcedureClient(plain)
const validatedClient = createProcedureClient(validated)
const middlewaresClient = createProcedureClient(middlewares)
const fullClient = createProcedureClient(full, {
  interceptors: [({ next }) => next()],
})

function buildMiddlewareProcedure(middlewareCount: number, addContext: boolean) {
  let builder = os as any

  for (let i = 0; i < middlewareCount; i++) {
    builder = builder.use(addContext
      ? os.middleware(async ({ next }) => next({ context: { [`key${i}`]: i } }))
      : os.middleware(async ({ next }) => next()))
  }

  return builder.handler(({ input }: any) => input)
}

/**
 * Middleware interleaved with input schemas: every level re-slices the schema
 * stack (`inputSchemasLengthAtUse`) and runs stacked-object merging.
 */
function buildStackedSchemaProcedure(middlewareCount: number) {
  let builder = os as any

  for (let i = 0; i < middlewareCount; i++) {
    builder = builder
      .use(os.middleware(async ({ next }) => next()))
      .input(type<any>())
  }

  return builder
    .output(type<any>())
    .handler(({ input }: any) => input)
}

const passthrough10Client = createProcedureClient(buildMiddlewareProcedure(10, false))
const passthrough100Client = createProcedureClient(buildMiddlewareProcedure(100, false))
const context10Client = createProcedureClient(buildMiddlewareProcedure(10, true))
const context50Client = createProcedureClient(buildMiddlewareProcedure(50, true))
const stacked10Client = createProcedureClient(buildStackedSchemaProcedure(10))
const stacked50Client = createProcedureClient(buildStackedSchemaProcedure(50))

describe('procedure call', () => {
  const input = {
    id: 1,
    name: `1tem-${1}`,
    active: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    largeInt: 9007199254740993n + BigInt(1),
  }

  bench('plain', async () => {
    await plainClient(input as any)
  })

  bench('validated', async () => {
    await validatedClient(input)
  })

  bench('middlewares', async () => {
    await middlewaresClient(input as any)
  })

  bench('full (middlewares + validated + interceptors)', async () => {
    await fullClient(input)
  })

  bench('10 middlewares (passthrough)', async () => {
    await passthrough10Client(input as any)
  })

  bench('100 middlewares (passthrough)', async () => {
    await passthrough100Client(input as any)
  })

  bench('10 middlewares (context-adding)', async () => {
    await context10Client(input as any)
  })

  bench('50 middlewares (context-adding)', async () => {
    await context50Client(input as any)
  })

  bench('10 middlewares + 11 stacked input schemas', async () => {
    await stacked10Client(input as any)
  })

  bench('50 middlewares + 51 stacked input schemas', async () => {
    await stacked50Client(input as any)
  })
})
