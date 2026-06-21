import type { Schema } from '@orpc/contract'
import type { ProcedureClient } from './procedure-client'
import type { RouterClient } from './router-client'
import { ORPCError } from '@orpc/client'
import z from 'zod'
import { os } from './builder'

const errorMap = {
  BASE: {
    data: z.string(),
  },
}

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const schema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform(n => `${n}`) })
const schema3 = z.object({ schema3: z.boolean().transform(n => `${n}`) })

const router = {
  ping: os.input(schema1).output(schema2).handler(() => {
    if (Math.random() > 0.5) {
      return new ORPCError('CODE', { data: 'data' })
    }

    return ({ schema2: 1 })
  }),
  nested: os.router({
    pong: os.input(schema3).output(schema2).errors(errorMap).handler(() => ({ schema2: 2 })),
  }),
  lazy: os.lazy(() => Promise.resolve({
    default: {
      peng: os.input(schema1).handler(() => 'output'),
    },
  })),
}

describe('RouterClient', () => {
  it('deep access', () => {
    const client = {} as RouterClient<typeof router, { cache?: boolean }>

    expectTypeOf(client.ping).toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema1, typeof schema2, object, ORPCError<'CODE', string>>
    >()

    expectTypeOf(client.nested).toEqualTypeOf<RouterClient<typeof router.nested, { cache?: boolean }>>()

    expectTypeOf(client.nested.pong).toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema3, typeof schema2, typeof errorMap, never>
    >()

    expectTypeOf(client.lazy.peng).toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema1, Schema<string>, object, never>
    >()
  })

  it('support single procedure', () => {
    type P = RouterClient<typeof router['ping'], { cache?: boolean }>

    expectTypeOf<P>().toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema1, typeof schema2, object, ORPCError<'CODE', string>>
    >()
  })
})
