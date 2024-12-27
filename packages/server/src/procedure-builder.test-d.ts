import type { RouteOptions } from '@orpc/contract'
import type { Middleware } from './middleware'
import type { DecoratedProcedure } from './procedure-decorated'
import type { ProcedureImplementer } from './procedure-implementer'
import type { Meta, WELL_CONTEXT } from './types'
import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { ProcedureBuilder } from './procedure-builder'

describe('self chainable', () => {
  const builder = new ProcedureBuilder<{ id?: string }, undefined, undefined, undefined>({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    middlewares: [],
  })

  const schema = z.object({ id: z.string().transform(v => Number.parseInt(v)) })

  it('route', () => {
    expectTypeOf(builder.route).toEqualTypeOf((route: RouteOptions) => builder)
  })

  it('input', () => {
    expectTypeOf(builder.input(schema))
      .toEqualTypeOf<ProcedureBuilder<{ id?: string }, undefined, typeof schema, undefined>>()

    expectTypeOf(builder.input(schema, { id: '1' }))
      .toEqualTypeOf<ProcedureBuilder<{ id?: string }, undefined, typeof schema, undefined>>()

    // @ts-expect-error - invalid schema
    builder.input({})

    // @ts-expect-error - invalid example
    builder.input(schema, {})

    // @ts-expect-error - invalid example
    builder.input(schema, { id: 1 })
  })

  it('output', () => {
    expectTypeOf(builder.output(schema))
      .toEqualTypeOf<ProcedureBuilder<{ id?: string }, undefined, undefined, typeof schema>>()

    expectTypeOf(builder.output(schema, { id: 1 }))
      .toEqualTypeOf<ProcedureBuilder<{ id?: string }, undefined, undefined, typeof schema>>()

    // @ts-expect-error - invalid schema
    builder.output({})

    // @ts-expect-error - invalid example
    builder.output(schema, {})

    // @ts-expect-error - invalid example
    builder.output(schema, { id: '1' })
  })
})

describe('to ProcedureImplementer', () => {
  const schema = z.object({ id: z.string().transform(v => Number.parseInt(v)) })

  const builder = new ProcedureBuilder<{ id?: string } | undefined, undefined, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [],
  })

  it('use middleware', () => {
    const implementer = builder.use(async (input, context, meta) => {
      expectTypeOf(context).toEqualTypeOf<{ id?: string } | undefined>()
      expectTypeOf(input).toEqualTypeOf<{ id: number }>()

      const result = await meta.next({})

      expectTypeOf(result.output).toEqualTypeOf<{ id: string }>()

      return meta.next({ context: { id: '1', extra: true } })
    })

    expectTypeOf(implementer).toEqualTypeOf<
      ProcedureImplementer<{ id?: string } | undefined, { id: string, extra: boolean }, typeof schema, typeof schema>
    >()
  })

  it('use middleware with map input', () => {
    const mid: Middleware<WELL_CONTEXT, { id: string, extra: boolean }, number, any> = (input, context, meta) => {
      return meta.next({
        context: { id: 'string', extra: true },
      })
    }

    const implementer = builder.use(mid, (input) => {
      expectTypeOf(input).toEqualTypeOf<{ id: number }>()
      return input.id
    })

    expectTypeOf(implementer).toEqualTypeOf<
      ProcedureImplementer<{ id?: string } | undefined, { id: string, extra: boolean }, typeof schema, typeof schema>
    >()

    // @ts-expect-error - invalid input
    builder.use(mid)

    // @ts-expect-error - invalid mapped input
    builder.use(mid, input => input)
  })

  it('use middleware prevent conflict on context', () => {
    builder.use((input, context, meta) => meta.next({}))
    builder.use((input, context, meta) => meta.next({ context: { id: '1' } }))
    builder.use((input, context, meta) => meta.next({ context: { id: '1', extra: true } }))
    builder.use((input, context, meta) => meta.next({ context: { auth: true } }))

    builder.use((input, context, meta) => meta.next({}), () => 'anything')
    builder.use((input, context, meta) => meta.next({ context: { id: '1' } }), () => 'anything')
    builder.use((input, context, meta) => meta.next({ context: { id: '1', extra: true } }), () => 'anything')
    builder.use((input, context, meta) => meta.next({ context: { auth: true } }), () => 'anything')

    // @ts-expect-error - conflict with context
    builder.use((input, context, meta) => meta.next({ context: { id: 1 } }))

    // @ts-expect-error - conflict with context
    builder.use((input, context, meta) => meta.next({ context: { id: 1, extra: true } }))

    // @ts-expect-error - conflict with context
    builder.use((input, context, meta) => meta.next({ context: { id: 1 } }), () => 'anything')

    // @ts-expect-error - conflict with context
    builder.use((input, context, meta) => meta.next({ context: { id: 1, extra: true } }), () => 'anything')
  })

  it('not allow use middleware with output is typed', () => {
    const mid1 = {} as Middleware<WELL_CONTEXT, undefined, unknown, any>
    const mid2 = {} as Middleware<WELL_CONTEXT, undefined, unknown, unknown>
    const mid3 = {} as Middleware<WELL_CONTEXT, undefined, unknown, { type: 'post', id: string }>

    builder.use(mid1)

    // @ts-expect-error - required used any for output
    builder.use(mid2)
    // @ts-expect-error - typed output is not allow because builder is not know output yet
    builder.use(mid3)
  })
})

describe('to DecoratedProcedure', () => {
  const schema = z.object({ id: z.string().transform(v => Number.parseInt(v)) })

  const builder = new ProcedureBuilder<{ id?: string } | undefined, undefined, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [],
  })

  it('handler', () => {
    const procedure = builder.handler(async (input, context, meta) => {
      expectTypeOf(context).toEqualTypeOf<{ id?: string } | undefined>()
      expectTypeOf(input).toEqualTypeOf<{ id: number }>()
      expectTypeOf(meta).toEqualTypeOf<Meta>()

      return { id: '1' }
    })

    expectTypeOf(procedure).toEqualTypeOf<
      DecoratedProcedure<{ id?: string } | undefined, undefined, typeof schema, typeof schema, { id: string }>
    >()

    // @ts-expect-error - invalid output
    builder.handler(async (input, context, meta) => ({ id: 1 }))

    // @ts-expect-error - invalid output
    builder.handler(async (input, context, meta) => (true))
  })
})
