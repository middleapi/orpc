import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import type {
  ProcedureContractBuilderWithInput,
  ProcedureContractBuilderWithOutput,
} from './builder-variants.ts'
import type { ContractBuilder } from './builder.ts'
import { oc } from './builder.ts'
import type { MergedErrorMap } from './error-utils.ts'
import type { Meta, MetaPlugin } from './meta.ts'
import type { ProcedureContract } from './procedure.ts'
import type { AugmentedContractRouter } from './router-utils.ts'
import type { Schema } from './schema.ts'

const errorMap = {
  BASE: {
    data: z.object({ id: z.string() }),
    message: 'base',
  },
}

const builder = {} as ContractBuilder<typeof errorMap>

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const schema1 = z.object({ schema1: z.number().transform((n) => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform((n) => `${n}`) })

describe('ContractBuilder', () => {
  it('is a contract procedure', () => {
    expectTypeOf(builder).toExtend<
      ProcedureContract<Schema<void, unknown>, Schema<unknown, unknown>, Record<never, never>>
    >()
  })

  it('.errors', () => {
    expectTypeOf(
      builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } }),
    ).toEqualTypeOf<
      ContractBuilder<
        MergedErrorMap<
          typeof errorMap,
          { INVALID: { message: string }; OVERRIDE: { message: string } }
        >
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
  })

  it('.meta', () => {
    const plugin = { name: 'test', init: (m: Meta) => m }
    expectTypeOf(builder.meta(plugin)).toEqualTypeOf<typeof builder>()

    // @ts-expect-error - invalid meta
    builder.meta({} as MetaPlugin<Schema<'invalid'>, any, any>)
  })

  it('.input', () => {
    expectTypeOf(builder.input(schema1)).toEqualTypeOf<
      ProcedureContractBuilderWithInput<typeof schema1, typeof errorMap>
    >()

    // @ts-expect-error - schema is invalid
    builder.input({})
  })

  it('.output', () => {
    expectTypeOf(builder.output(schema2)).toEqualTypeOf<
      ProcedureContractBuilderWithOutput<typeof schema2, typeof errorMap>
    >()

    // @ts-expect-error - schema is invalid
    builder.output({})
  })

  it('.router', () => {
    const router = {
      ping: oc.input(schema1).output(schema2),
    }

    expectTypeOf(builder.router(router)).toEqualTypeOf<
      AugmentedContractRouter<typeof router, typeof errorMap>
    >()

    // @ts-expect-error - invalid router
    builder.router(123)
  })
})

describe('oc', () => {
  it('is a contract builder', () => {
    expectTypeOf(oc).toEqualTypeOf<ContractBuilder<Record<never, never>>>()
  })
})
