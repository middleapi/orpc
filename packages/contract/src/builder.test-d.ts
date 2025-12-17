import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../tests/shared'
import type { ContractBuilder } from './builder'
import type { ContractProcedureBuilder, ContractProcedureBuilderWithInput, ContractProcedureBuilderWithOutput, ContractRouterBuilder } from './builder-variants'
import type { MergedErrorMap } from './error'
import type { ContractProcedure } from './procedure'
import type { EnhancedContractRouter } from './router-utils'
import type { Schema } from './schema'
import { generalSchema, ping, pong } from '../tests/shared'

const builder = {} as ContractBuilder<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>

describe('ContractBuilder', () => {
  it('is a contract procedure', () => {
    expectTypeOf(builder).toMatchTypeOf<
      ContractProcedure<
        typeof inputSchema,
        typeof outputSchema,
        Record<never, never>,
        BaseMeta
      >
    >()
  })

  it('.$meta', () => {
    type MetaDef = { meta1?: string, meta2?: number }

    expectTypeOf(builder.$meta<MetaDef>({ meta1: 'value' })).toEqualTypeOf<
      ContractBuilder<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, MetaDef & Record<never, never>>
    >()

    // @ts-expect-error - invalid initial meta
    builder.$meta<MetaDef>({ meta1: 123 })
  })

  it('.$route', () => {
    expectTypeOf(builder.$route({ method: 'GET', path: '/api' })).toEqualTypeOf<
      typeof builder
    >()

    // @ts-expect-error - method is invalid
    builder.$route({ method: 'INVALID' })
  })

  it('.$input', () => {
    expectTypeOf(builder.$input(generalSchema)).toEqualTypeOf<
      ContractBuilder<typeof generalSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - schema is invalid
    builder.$input({})
  })

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ContractBuilder<
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<typeof baseErrorMap, { INVALID: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
  })

  it('.meta', () => {
    expectTypeOf(builder.meta({ log: true })).toEqualTypeOf<
      ContractProcedureBuilder<
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ meta: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ method: 'GET' })).toEqualTypeOf<
      ContractProcedureBuilder<
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid method
    builder.route({ method: 'INVALID' })
  })

  it('.input', () => {
    expectTypeOf(builder.input(generalSchema)).toEqualTypeOf<
      ContractProcedureBuilderWithInput<
        typeof generalSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.input({})
  })

  it('.output', () => {
    expectTypeOf(builder.output(generalSchema)).toEqualTypeOf<
      ContractProcedureBuilderWithOutput<
        typeof inputSchema,
        typeof generalSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.output({})
  })

  it('.prefix', () => {
    expectTypeOf(builder.prefix('/api')).toEqualTypeOf<
      ContractRouterBuilder<typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid prefix
    builder.prefix(1)
  })

  it('.tag', () => {
    expectTypeOf(builder.tag('tag1', 'tag2')).toEqualTypeOf<
      ContractRouterBuilder<typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid tag
    builder.tag(1)
  })

  it('.router', () => {
    const router = {
      ping,
      pong,
    }

    expectTypeOf(builder.router(router)).toEqualTypeOf<
      EnhancedContractRouter<typeof router, typeof baseErrorMap>
    >()

    // @ts-expect-error - invalid router
    builder.router(123)

    builder.router({
      // @ts-expect-error - conflict meta def
      ping: {} as ContractProcedure<
        Schema<unknown, unknown>,
        typeof outputSchema,
        typeof baseErrorMap,
        { mode?: number }
      >,
    })
  })
})
