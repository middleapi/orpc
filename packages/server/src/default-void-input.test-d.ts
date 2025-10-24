import type { Schema } from '@orpc/contract'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { os } from './builder'

describe('default void input - type tests', () => {
  it('should infer void input type when input() is not specified', () => {
    const procedure = os
      .output(z.string())
      .handler(() => 'result')

    type InputSchema = typeof procedure extends { '~orpc': { inputSchema: infer S } } ? S : never

    expectTypeOf<InputSchema>().toEqualTypeOf<Schema<void, void>>()
  })

  it('should allow handler without input parameter when input() is not specified', () => {
    const procedure = os
      .output(z.string())
      .handler(() => 'result')

    expectTypeOf(procedure).toMatchTypeOf<{
      '~orpc': {
        inputSchema: Schema<void, void>
        outputSchema: Schema<string, string>
      }
    }>()
  })

  it('should match explicit void input type', () => {
    const procedureWithoutInput = os
      .output(z.string())
      .handler(() => 'result1')

    const procedureWithVoidInput = os
      .input(z.void())
      .output(z.string())
      .handler(() => 'result2')

    type InputSchema1 = typeof procedureWithoutInput extends { '~orpc': { inputSchema: infer S } } ? S : never
    type InputSchema2 = typeof procedureWithVoidInput extends { '~orpc': { inputSchema: infer S } } ? S : never

    expectTypeOf<InputSchema1>().toEqualTypeOf<InputSchema2>()
  })

  it('should still allow explicit input schema to override', () => {
    const procedure = os
      .input(z.object({ name: z.string() }))
      .output(z.string())
      .handler(({ input }) => `Hello ${input.name}`)

    type InputSchema = typeof procedure extends { '~orpc': { inputSchema: infer S } } ? S : never

    expectTypeOf<InputSchema>().not.toEqualTypeOf<Schema<void, void>>()
  })

  it('should work with middleware chaining', () => {
    const middleware = os.middleware(() => ({ context: { user: 'test' } }))

    const procedure = middleware
      .output(z.string())
      .handler(({ context }) => `User: ${context.user}`)

    type InputSchema = typeof procedure extends { '~orpc': { inputSchema: infer S } } ? S : never

    expectTypeOf<InputSchema>().toEqualTypeOf<Schema<void, void>>()
  })

  it('should work in router definition', () => {
    const testRouter = {
      withoutInput: os
        .output(z.string())
        .handler(() => 'result'),
      withInput: os
        .input(z.object({ id: z.string() }))
        .output(z.string())
        .handler(({ input }) => `ID: ${input.id}`),
    }

    type WithoutInputSchema = typeof testRouter.withoutInput extends { '~orpc': { inputSchema: infer S } } ? S : never
    type WithInputSchema = typeof testRouter.withInput extends { '~orpc': { inputSchema: infer S } } ? S : never

    expectTypeOf<WithoutInputSchema>().toEqualTypeOf<Schema<void, void>>()
    expectTypeOf<WithInputSchema>().not.toEqualTypeOf<Schema<void, void>>()
  })
})
