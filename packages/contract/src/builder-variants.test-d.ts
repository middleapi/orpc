import type { OmitChainMethodDeep } from '@orpc/shared'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../tests/shared'
import type { ContractBuilder } from './builder'
import type { ContractProcedureBuilder, ContractProcedureBuilderWithInput, ContractProcedureBuilderWithInputOutput, ContractProcedureBuilderWithOutput, ContractRouterBuilder } from './builder-variants'
import type { MergedErrorMap } from './error'
import type { ContractProcedure } from './procedure'
import type { EnhancedContractRouter } from './router-utils'
import type { Schema } from './schema'
import { generalSchema, ping, pong } from '../tests/shared'

const generalBuilder = {} as ContractBuilder<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>

describe('ContractProcedureBuilder', () => {
  const builder = {} as ContractProcedureBuilder<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<typeof generalBuilder, '$meta' | '$route' | '$input' | 'prefix' | 'tag' | 'router'>

    expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ContractProcedureBuilder<
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
})

describe('ContractProcedureBuilderWithInput', () => {
  const builder = {} as ContractProcedureBuilderWithInput<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<typeof generalBuilder, '$meta' | '$route' | '$input' | 'prefix' | 'tag' | 'router' | 'input'>

    expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ContractProcedureBuilderWithInput<
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
      ContractProcedureBuilderWithInput<
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
      ContractProcedureBuilderWithInput<
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid method
    builder.route({ method: 'INVALID' })
  })

  it('.output', () => {
    expectTypeOf(builder.output(generalSchema)).toEqualTypeOf<
      ContractProcedureBuilderWithInputOutput<
        typeof inputSchema,
        typeof generalSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.output({})
  })
})

describe('ContractProcedureBuilderWithOutput', () => {
  const builder = {} as ContractProcedureBuilderWithOutput<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<typeof generalBuilder, '$meta' | '$route' | '$input' | 'prefix' | 'tag' | 'router' | 'output'>

    expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ContractProcedureBuilderWithOutput<
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
      ContractProcedureBuilderWithOutput<
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
      ContractProcedureBuilderWithOutput<
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
      ContractProcedureBuilderWithInputOutput<
        typeof generalSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.input({})
  })
})

it('ContractProcedureBuilderWithInputOutput', () => {
  const builder = {} as ContractProcedureBuilderWithInputOutput<typeof inputSchema, typeof outputSchema, typeof baseErrorMap, BaseMeta>

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<typeof generalBuilder, '$meta' | '$route' | '$input' | 'prefix' | 'tag' | 'router' | 'input' | 'output'>

    expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ContractProcedureBuilderWithInputOutput<
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
      ContractProcedureBuilderWithInputOutput<
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
      ContractProcedureBuilderWithInputOutput<
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid method
    builder.route({ method: 'INVALID' })
  })
})

describe('ContractRouterBuilder', () => {
  const builder = {} as ContractRouterBuilder<typeof baseErrorMap, BaseMeta>

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<typeof generalBuilder, '$meta' | '$route' | '$input' | 'route' | 'meta' | 'input' | 'output'>

    // expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
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
