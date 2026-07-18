import type { ORPCMeta } from '../src/to-orpc-router'
import { initTRPC, lazy, tracked, TRPCError } from '@trpc/server'
import * as z from 'zod'

export const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })

export const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

export type TRPCContext = { a: string }
export interface TRPCMeta extends ORPCMeta {
  meta1?: string
  meta2?: number
}

export const t = initTRPC.context<(req: Request) => (TRPCContext)>().meta<TRPCMeta>().create()

export const trpcRouter = t.router({
  ping: t.procedure
    .meta({ meta1: 'test' })
    .input(inputSchema)
    .output(outputSchema)
    .query(({ input }) => {
      return { output: Number(input.input) }
    }),

  throw: t.procedure
    .meta({ meta2: 42 })
    .input(z.object({ b: z.number(), c: z.string() }))
    .query(() => {
      throw new TRPCError({
        code: 'PARSE_ERROR',
        message: 'throw',
      })
    }),

  subscribe: t.procedure
    .input(z.object({ u: z.string() }))
    .subscription(async function* () {
      yield 'pong'
      yield tracked('id-1', { order: 1 })
      yield tracked('id-2', { order: 2 })
    }),

  nested: {
    ping: t.procedure
      .meta({ route: { path: '/nested/ping', description: 'Nested ping procedure' } })
      .input(z.object({ a: z.string() }))
      .output(z.string().transform(val => Number(val)))
      .query(({ input }) => {
        return `1234${input.a}`
      }),
  },

  lazy: lazy(() => Promise.resolve({ default: t.router({
    subscribe: t.procedure
      .subscription(async function* () {
        yield 'pong'
      }),

    lazy: lazy(() => Promise.resolve({ default: t.router({
      throw: t.procedure
        .meta({ meta1: 'nested' })
        .input(inputSchema)
        .output(outputSchema)
        .query(() => {
          throw new Error('lazy.lazy.throw')
        }),
    }) })),
  }) })),
})
