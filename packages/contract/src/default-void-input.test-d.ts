import type { Schema } from '@orpc/contract'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { oc } from './builder'

describe('default void input - contract - type tests', () => {
  it('should infer void input type when input() is not specified', () => {
    const contract = oc
      .output(z.string())

    type InputSchema = typeof contract extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<InputSchema>().toEqualTypeOf<Schema<void, void>>()
  })

  it('should match explicit void input type', () => {
    const contractWithoutInput = oc
      .output(z.string())

    const contractWithVoidInput = oc
      .input(z.void())
      .output(z.string())

    type InputSchema1 = typeof contractWithoutInput extends { '~orpc': { inputSchema?: infer S } } ? S : never
    type InputSchema2 = typeof contractWithVoidInput extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<InputSchema1>().toEqualTypeOf<InputSchema2>()
  })

  it('should still allow explicit input schema to override', () => {
    const contract = oc
      .input(z.object({ name: z.string() }))
      .output(z.string())

    type InputSchema = typeof contract extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<InputSchema>().not.toEqualTypeOf<Schema<void, void>>()
  })

  it('should work with metadata chaining', () => {
    const contract = oc
      .meta({ description: 'A test procedure' })
      .output(z.string())

    type InputSchema = typeof contract extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<InputSchema>().toEqualTypeOf<Schema<void, void>>()
  })

  it('should work with route definition', () => {
    const contract = oc
      .route({ method: 'GET', path: '/test' })
      .output(z.string())

    type InputSchema = typeof contract extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<InputSchema>().toEqualTypeOf<Schema<void, void>>()
  })

  it('should work with error mapping', () => {
    const contract = oc
      .errors({ NOT_FOUND: z.object({ message: z.string() }) })
      .output(z.string())

    type InputSchema = typeof contract extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<InputSchema>().toEqualTypeOf<Schema<void, void>>()
  })

  it('should work in contract router definition', () => {
    const contractRouter = {
      withoutInput: oc
        .output(z.string()),
      withInput: oc
        .input(z.object({ id: z.string() }))
        .output(z.string()),
    }

    type WithoutInputSchema = typeof contractRouter.withoutInput extends { '~orpc': { inputSchema?: infer S } } ? S : never
    type WithInputSchema = typeof contractRouter.withInput extends { '~orpc': { inputSchema?: infer S } } ? S : never

    expectTypeOf<WithoutInputSchema>().toEqualTypeOf<Schema<void, void>>()
    expectTypeOf<WithInputSchema>().not.toEqualTypeOf<Schema<void, void>>()
  })
})
