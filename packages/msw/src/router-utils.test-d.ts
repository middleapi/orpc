import type { Public } from '@orpc/shared'
import type { ProcedureUtils } from './procedure-utils'
import type { RouterUtils } from './router-utils'
import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import z from 'zod'
import { createRouterUtils } from './router-utils'

const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })
const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

const contract = {
  ping: oc.input(inputSchema).output(outputSchema),
  nested: {
    pong: oc,
  },
}

it('mirrors the router-contract shape', () => {
  const utils = createRouterUtils(contract)

  expectTypeOf(utils).toEqualTypeOf<RouterUtils<typeof contract>>()
  expectTypeOf(utils.ping).toExtend<Public<ProcedureUtils<typeof inputSchema, typeof outputSchema, object>>>()
  expectTypeOf(utils.nested.pong).toExtend<{ loading: () => unknown }>()

  // @ts-expect-error --- not a procedure
  expectTypeOf(utils.nested.handler)
})

it('supports implemented routers', () => {
  const router = {
    ping: os
      .input(inputSchema)
      .output(outputSchema)
      .handler(({ input }) => ({ output: Number(input.input) })),
  }

  const utils = createRouterUtils(router)

  utils.ping.handler(({ input }) => {
    expectTypeOf(input).toEqualTypeOf<{ input: string }>()

    return { output: 123 }
  })

  // @ts-expect-error --- output must match the output schema input type
  utils.ping.handler(() => ({ output: '123' }))
})
