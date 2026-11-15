import type { ORPCError } from '@orpc/client'
import type { ThrowableError } from '@orpc/shared'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { oc } from './builder'
import type {
  InferRouterContractError,
  InferRouterContractErrorMap,
  InferRouterContractErrors,
  InferRouterContractInputs,
  InferRouterContractOutputs,
} from './router'

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const schema1 = z.object({ schema1: z.string().transform((n) => Number(n)) })
const schema2 = z.object({ schema2: z.string().transform((n) => Number(n)) })

const ping = oc.input(schema1).output(schema2)

const pong = oc.errors({
  BAD_GATEWAY: {
    data: schema1,
  },
})

const notFound = oc.errors({
  NOT_FOUND: {
    data: schema2,
  },
})

const router = {
  ping,
  pong,
  nested: {
    ping,
    pong,
  },
}

const errorRouter = {
  pong,
  nested: {
    notFound,
  },
}

it('InferRouterContractInputs', () => {
  type Inputs = InferRouterContractInputs<typeof router>

  expectTypeOf<Inputs['ping']>().toEqualTypeOf<{ schema1: string }>()
  expectTypeOf<Inputs['pong']>().toEqualTypeOf<void>()

  expectTypeOf<Inputs['nested']['ping']>().toEqualTypeOf<{ schema1: string }>()
  expectTypeOf<Inputs['nested']['pong']>().toEqualTypeOf<void>()
})

it('InferRouterContractOutputs', () => {
  type Outputs = InferRouterContractOutputs<typeof router>

  expectTypeOf<Outputs['ping']>().toEqualTypeOf<{ schema2: number }>()
  expectTypeOf<Outputs['pong']>().toEqualTypeOf<unknown>()

  expectTypeOf<Outputs['nested']['ping']>().toEqualTypeOf<{ schema2: number }>()
  expectTypeOf<Outputs['nested']['pong']>().toEqualTypeOf<unknown>()
})

it('InferRouterContractErrorMap', () => {
  expectTypeOf<InferRouterContractErrorMap<typeof pong>>().toExtend<{
    BAD_GATEWAY: { data: typeof schema1 }
  }>()

  expectTypeOf<{
    BAD_GATEWAY: { data: typeof schema1 }
  }>().toExtend<InferRouterContractErrorMap<typeof router>>()
})

it('InferRouterContractErrors', () => {
  type Errors = InferRouterContractErrors<typeof errorRouter>

  expectTypeOf<Errors['pong']>().toEqualTypeOf<
    ORPCError<'BAD_GATEWAY', { schema1: number }> | ThrowableError
  >()
  expectTypeOf<Errors['nested']['notFound']>().toEqualTypeOf<
    ORPCError<'NOT_FOUND', { schema2: number }> | ThrowableError
  >()
})

it('InferRouterContractError', () => {
  expectTypeOf<InferRouterContractError<typeof errorRouter>>().toEqualTypeOf<
    | ORPCError<'BAD_GATEWAY', { schema1: number }>
    | ORPCError<'NOT_FOUND', { schema2: number }>
    | ThrowableError
  >()
})

describe('optional keys', () => {
  type OptionalRouter = {
    ping?: typeof ping
    nested?: {
      pong?: typeof pong
      notFound?: typeof notFound
    }
  }

  it('InferRouterContractInputs', () => {
    expectTypeOf<
      InferRouterContractInputs<{ ping?: typeof ping; nested?: { ping?: typeof ping } }>
    >().toEqualTypeOf<{
      ping?: { schema1: string } | undefined
      nested?: { ping?: { schema1: string } | undefined } | undefined
    }>()
  })

  it('InferRouterContractOutputs', () => {
    expectTypeOf<InferRouterContractOutputs<OptionalRouter>>().toEqualTypeOf<{
      ping?: { schema2: number } | undefined
      nested?: { pong?: unknown; notFound?: unknown } | undefined
    }>()
  })

  it('InferRouterContractErrorMap', () => {
    expectTypeOf<InferRouterContractErrorMap<OptionalRouter>>().toEqualTypeOf<
      InferRouterContractErrorMap<{
        ping: typeof ping
        nested: { pong: typeof pong; notFound: typeof notFound }
      }>
    >()
  })

  it('InferRouterContractErrors', () => {
    expectTypeOf<InferRouterContractErrors<OptionalRouter>>().toEqualTypeOf<{
      ping?: ThrowableError | undefined
      nested?:
        | {
            pong?: ORPCError<'BAD_GATEWAY', { schema1: number }> | ThrowableError | undefined
            notFound?: ORPCError<'NOT_FOUND', { schema2: number }> | ThrowableError | undefined
          }
        | undefined
    }>()
  })

  it('InferRouterContractError', () => {
    expectTypeOf<InferRouterContractError<OptionalRouter>>().toEqualTypeOf<
      | ORPCError<'BAD_GATEWAY', { schema1: number }>
      | ORPCError<'NOT_FOUND', { schema2: number }>
      | ThrowableError
    >()
  })
})
