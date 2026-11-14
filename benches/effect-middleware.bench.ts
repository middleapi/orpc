import { middlewareGen } from '@orpc/effect'
import type { AnyMiddleware } from '@orpc/server'
import { createProcedureClient, os } from '@orpc/server'
import { bench } from 'vitest'

const plain = os.middleware(async ({ next }) => next())

const gen = middlewareGen(function* ({ next }) {
  return yield* next()
})

function createChainClient(middleware: AnyMiddleware, depth: number) {
  let builder: any = os
  for (let i = 0; i < depth; i++) {
    builder = builder.use(middleware)
  }
  return createProcedureClient(builder.handler(() => 'output'))
}

describe('effect middleware', () => {
  for (const depth of [1, 5, 10, 20]) {
    describe(`depth ${depth}`, () => {
      const plainClient = createChainClient(plain, depth)
      const genClient = createChainClient(gen, depth)

      bench('plain middleware', async () => {
        await plainClient(undefined, { signal: new AbortController().signal })
      })

      bench('middlewareGen', async () => {
        await genClient(undefined, { signal: new AbortController().signal })
      })

      bench('middlewareGen without signal', async () => {
        await genClient(undefined)
      })
    })
  }
})
