import * as z from 'zod'

import { os } from './builder.ts'
import { call } from './procedure-utils.ts'

describe('call', () => {
  it('requires input, options if context is required', async () => {
    const procedure = os.$context<{ auth: boolean }>().handler(() => 'output')

    // @ts-expect-error require input & options
    void call(procedure)
    // @ts-expect-error require options
    void call(procedure, undefined)

    const output = await call(procedure, undefined, { context: { auth: true } })
    expectTypeOf(output).toEqualTypeOf<string>()
  })

  it('requires input if input is required', async () => {
    const procedure = os.input(z.string()).handler(() => 'output')

    // @ts-expect-error require input & options
    void call(procedure)

    const output = await call(procedure, 'input')
    expectTypeOf(output).toEqualTypeOf<string>()
  })

  it('optional input & context if both is optional', async () => {
    const procedure = os.input(z.string().optional()).handler(() => 'output')

    const output = await call(procedure)
    expectTypeOf(output).toEqualTypeOf<string>()
  })

  it('infer correct input types', () => {
    const procedure = os.input(z.number()).handler(() => 'output')

    // @ts-expect-error require input is invalid
    void call(procedure, 'invalid')
    void call(procedure, 123)
  })

  it('infer correct context types', () => {
    const procedure = os.$context<{ auth: boolean }>().handler(() => 'output')

    // @ts-expect-error require input is invalid
    void call(procedure, undefined, { context: { auth: 'invalid' } })
    void call(procedure, undefined, { context: { auth: true } })
  })
})
