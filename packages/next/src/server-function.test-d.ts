import type { ORPCErrorCode } from '@orpc/server'
import { os } from '@orpc/server'
import { useActionState } from 'react'
import { z } from 'zod'
import { createServerFunction } from './server-function'

const errorMap = {
  BASE: {
    data: z.object({ id: z.string() }),
    message: 'base',
  },
}

const schema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform(n => `${n}`) })

describe('createServerFunction', () => {
  const procedure = os
    .$context<{ auth: boolean }>()
    .input(schema1)
    .output(schema2)
    .errors(errorMap)
    .handler(() => {
      return { schema2: 123 }
    })

  it('support typesafe errors and infer correct types', async () => {
    // @ts-expect-error missing context
    createServerFunction(procedure)
    // @ts-expect-error invalid context
    createServerFunction(procedure, { context: () => ({ auth: 'invalid' }) })
    const fn = createServerFunction(procedure, { context: () => ({ auth: true }) })

    // @ts-expect-error missing input
    fn()
    // @ts-expect-error invalid input
    fn('invalid')
    const [error, data] = await fn({ schema1: 123 })

    if (error) {
      if (error.defined) {
        if (error.code === 'BASE') {
          expectTypeOf(error.data).toEqualTypeOf<{ id: string }>()
        }
      }
      else {
        expectTypeOf(error.code).toEqualTypeOf<ORPCErrorCode>()
        expectTypeOf(error.data).toEqualTypeOf<unknown>()
      }
    }
    else {
      expectTypeOf(data).toEqualTypeOf<{ schema2: string }>()
    }
  })

  it('plugs into useActionState', () => {
    const fn = createServerFunction(procedure, { context: () => ({ auth: true }) })

    const [state, dispatch] = useActionState(fn, null)
    expectTypeOf(state).toEqualTypeOf<Awaited<ReturnType<typeof fn>> | null>()
    dispatch({ schema1: 123 })
    dispatch(new FormData())
    // @ts-expect-error invalid input
    dispatch({ schema1: 'invalid' })

    const [initialized] = useActionState(fn, [null, { schema2: '123' }])
    expectTypeOf(initialized).toEqualTypeOf<Awaited<ReturnType<typeof fn>>>()

    // @ts-expect-error initial state must match the result
    useActionState(fn, [null, { schema2: 123 }])
  })

  it('plugs into useActionState for procedures without input', () => {
    const fn = createServerFunction(os.handler(() => 'output'))

    const [state, dispatch] = useActionState(fn, null)
    if (state && !state[0]) {
      expectTypeOf(state[1]).toEqualTypeOf<string>()
    }
    dispatch()
  })
})
