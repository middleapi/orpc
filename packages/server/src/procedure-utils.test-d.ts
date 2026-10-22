import type { AnySchema, ErrorMap, InferSchemaInput } from '@orpc/contract'
import type { Context } from './context'
import type { Procedure } from './procedure'
import type { CallOptions } from './procedure-utils'
import z from 'zod'
import { os } from './builder'
import { call } from './procedure-utils'

describe('call', () => {
  it('requires input, options if context is required', async () => {
    const procedure = os
      .$context<{ auth: boolean }>()
      .handler(() => 'output')

    // @ts-expect-error require input & options
    call(procedure)
    // @ts-expect-error require options
    call(procedure, undefined)

    const output = await call(procedure, undefined, { context: { auth: true } })
    expectTypeOf(output).toEqualTypeOf<string>()
  })

  it('requires input if input is required', async () => {
    const procedure = os
      .input(z.string())
      .handler(() => 'output')

    // @ts-expect-error require input & options
    call(procedure)

    const output = await call(procedure, 'input')
    expectTypeOf(output).toEqualTypeOf<string>()
  })

  it('optional input & context if both is optional', async () => {
    const procedure = os
      .input(z.string().optional())
      .handler(() => 'output')

    const output = await call(procedure)
    expectTypeOf(output).toEqualTypeOf<string>()
  })

  it('infer correct input types', () => {
    const procedure = os
      .input(z.number())
      .handler(() => 'output')

    // @ts-expect-error require input is invalid
    call(procedure, 'invalid')
    call(procedure, 123)
  })

  it('infer correct context types', () => {
    const procedure = os
      .$context<{ auth: boolean }>()
      .handler(() => 'output')

    // @ts-expect-error require input is invalid
    call(procedure, undefined, { context: { auth: 'invalid' } })
    call(procedure, undefined, { context: { auth: true } })
  })

  it('can spread generic options', () => {
    function forward<
      TInitialContext extends Context,
      TInputSchema extends AnySchema,
      TOutputSchema extends AnySchema,
      TErrorMap extends ErrorMap,
    >(
      procedure: Procedure<TInitialContext, any, TInputSchema, TOutputSchema, TErrorMap>,
      input: InferSchemaInput<TInputSchema>,
      options: CallOptions<TInitialContext, TOutputSchema, TErrorMap>,
      context: TInitialContext,
    ) {
      call(procedure, input, options)
      call(procedure, input, { ...options, path: ['x'] })
      call(procedure, input, { ...options, context })
    }
  })
})
