import type { Middleware, MiddlewareMeta } from './middleware'
import type { DecoratedProcedure } from './procedure-decorated'
import type { Meta, WELL_CONTEXT } from './types'
import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { ProcedureImplementer } from './procedure-implementer'

describe('self chainable', () => {
  const global_mid = vi.fn()
  const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })
  const implementer = new ProcedureImplementer<{ id?: string }, undefined, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [global_mid],
  })

  it('use middleware', () => {
    const i = implementer
      .use((input, context, meta) => {
        expectTypeOf(input).toEqualTypeOf<{ val: number }>()
        expectTypeOf(context).toEqualTypeOf<{ id?: string }>()
        expectTypeOf(meta).toEqualTypeOf<MiddlewareMeta<{ val: string }>>()

        return meta.next({
          context: {
            auth: true,
          },
        })
      })
      .use((input, context, meta) => {
        expectTypeOf(input).toEqualTypeOf<{ val: number }>()
        expectTypeOf(context).toEqualTypeOf<
          { id?: string } & { auth: boolean }
        >()
        expectTypeOf(meta).toEqualTypeOf<MiddlewareMeta<{ val: string }>>()

        return meta.next({})
      })

    expectTypeOf(i).toEqualTypeOf<
      ProcedureImplementer<
        { id?: string },
        { auth: boolean },
        typeof schema,
        typeof schema
      >
    >()
  })

  it('use middleware with map input', () => {
    const mid: Middleware<WELL_CONTEXT, { id: string, extra: boolean }, number, any> = (input, context, meta) => {
      return meta.next({
        context: { id: 'string', extra: true },
      })
    }

    const i = implementer.use(mid, (input) => {
      expectTypeOf(input).toEqualTypeOf<{ val: number }>()
      return input.val
    })

    expectTypeOf(i).toEqualTypeOf<
      ProcedureImplementer<
        { id?: string },
        { id: string, extra: boolean },
        typeof schema,
        typeof schema
      >
    >()

    // @ts-expect-error - invalid input
    implementer.use(mid)

    // @ts-expect-error - invalid mapped input
    implementer.use(mid, input => input)
  })

  it('prevent conflict on context', () => {
    implementer.use((input, context, meta) => meta.next({}))
    implementer.use((input, context, meta) => meta.next({ context: { id: '1' } }))
    implementer.use((input, context, meta) => meta.next({ context: { id: '1', extra: true } }))
    implementer.use((input, context, meta) => meta.next({ context: { auth: true } }))

    implementer.use((input, context, meta) => meta.next({}), () => 'anything')
    implementer.use((input, context, meta) => meta.next({ context: { id: '1' } }), () => 'anything')
    implementer.use((input, context, meta) => meta.next({ context: { id: '1', extra: true } }), () => 'anything')
    implementer.use((input, context, meta) => meta.next({ context: { auth: true } }), () => 'anything')

    // @ts-expect-error - conflict with context
    implementer.use((input, context, meta) => meta.next({ context: { id: 1 } }))

    // @ts-expect-error - conflict with context
    implementer.use((input, context, meta) => meta.next({ context: { id: 1, extra: true } }))

    // @ts-expect-error - conflict with context
    implementer.use((input, context, meta) => meta.next({ context: { id: 1 } }), () => 'anything')

    // @ts-expect-error - conflict with context
    implementer.use((input, context, meta) => meta.next({ context: { id: 1, extra: true } }), () => 'anything')
  })

  it('handle middleware with output is typed', () => {
    const mid1 = {} as Middleware<WELL_CONTEXT, undefined, unknown, any>
    const mid2 = {} as Middleware<WELL_CONTEXT, undefined, unknown, { val: string }>
    const mid3 = {} as Middleware<WELL_CONTEXT, undefined, unknown, unknown>
    const mid4 = {} as Middleware<WELL_CONTEXT, undefined, unknown, { val: number }>

    implementer.use(mid1)
    implementer.use(mid2)
    // @ts-expect-error - required used any for output
    implementer.use(mid3)
    // @ts-expect-error - output is not match
    implementer.use(mid4)
  })
})

describe('to DecoratedProcedure', () => {
  const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })

  const global_mid = vi.fn()
  const implementer = new ProcedureImplementer<{ id?: string } | undefined, { db: string }, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [global_mid],
  })

  it('handler', () => {
    const procedure = implementer.handler((input, context, meta) => {
      expectTypeOf(context).toEqualTypeOf<({ id?: string } & { db: string }) | { db: string }>()
      expectTypeOf(input).toEqualTypeOf<{ val: number }>()
      expectTypeOf(meta).toEqualTypeOf<Meta>()

      return { val: '1' }
    })

    expectTypeOf(procedure).toEqualTypeOf<
      DecoratedProcedure<{ id?: string } | undefined, { db: string }, typeof schema, typeof schema, { val: string }>
    >()

    // @ts-expect-error - invalid output
    implementer.handler(() => ({ val: 1 }))

    // @ts-expect-error - invalid output
    implementer.handler(() => {})
  })
})
