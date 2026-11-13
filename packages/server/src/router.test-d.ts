import type { ORPCError } from '@orpc/client'
import type { MergedErrorMap, Schema } from '@orpc/contract'
import { oc } from '@orpc/contract'
import type { ThrowableError } from '@orpc/shared'
import * as z from 'zod'

import type { Lazy, Lazyable } from './lazy'
import type { Procedure } from './procedure'
import type {
  ContractedRouter,
  InferRouterError,
  InferRouterErrors,
  InferRouterFinalContexts,
  InferRouterInitialContext,
  InferRouterInitialContexts,
  InferRouterInputs,
  InferRouterOutputs,
  Router,
} from './router'

describe('contractedRouter', () => {
  // Schemas should have distinct TInput and TOutput types to ensure correct inference.
  const inputSchema = z.object({ input: z.number().transform((n) => `${n}`) })
  const outputSchema = z.object({ output: z.string().transform((s) => Number(s)) })

  const errorMap = {
    INTERNAL_SERVER_ERROR: {
      data: z.object({ id: z.string().transform((s) => Number(s)) }),
    },
  }

  const ping = oc.input(inputSchema)
  const pong = oc.output(outputSchema).errors(errorMap)

  const contract = oc.router({
    ping,
    pong,
    nested: {
      ping,
      pong,
    },
  })

  it('is a router', () => {
    expectTypeOf<ContractedRouter<typeof contract, { init?: boolean }>>().toExtend<
      Router<{ init?: boolean }>
    >()
  })

  it('maps to procedure', () => {
    type Router = ContractedRouter<typeof contract, { init?: boolean }>

    expectTypeOf<Router['ping']>().toEqualTypeOf<
      Lazyable<
        Procedure<
          { init?: boolean },
          any,
          typeof inputSchema,
          Schema<unknown>,
          Record<never, never>
        >
      >
    >()

    // FIX: this should be .toEqualTypeOf
    expectTypeOf<Router['pong']>().toExtend<
      Lazyable<
        Procedure<
          { init?: boolean },
          any,
          Schema<void, unknown>,
          typeof outputSchema,
          MergedErrorMap<Record<never, never>, typeof errorMap>
        >
      >
    >()

    expectTypeOf<Exclude<Router['nested'], Lazy<any>>['ping']>().toEqualTypeOf<Router['ping']>()

    expectTypeOf<Exclude<Router['nested'], Lazy<any>>['pong']>().toEqualTypeOf<Router['pong']>()
  })

  it('support single procedure', () => {
    type P = ContractedRouter<(typeof contract)['ping'], { init?: boolean }>

    expectTypeOf<P>().toEqualTypeOf<
      Procedure<{ init?: boolean }, any, typeof inputSchema, Schema<unknown>, Record<never, never>>
    >()
  })
})

describe('infer utilities', () => {
  type Schema1 = Schema<{ input: number }, { output: string }>
  type Schema2 = Schema<{ input: string }, { output: number }>
  type Schema3 = Schema<{ value: boolean }>

  const router = {
    ping: {} as Procedure<
      { init1?: boolean },
      object,
      Schema1,
      Schema2,
      { AUTH: { message: string } }
    >,
    pong: {} as Procedure<{ init2?: boolean }, { extra: true }, Schema2, Schema<unknown>, object>,
    nested: {
      ping: {} as Procedure<
        { init3?: boolean },
        object,
        Schema1,
        Schema3,
        { AUTH: { message: string } }
      >,
      pong: {} as Procedure<{ init4?: boolean }, { extra: true }, Schema3, Schema<unknown>, object>,
    },
  }

  it('InferRouterInitialContext', () => {
    expectTypeOf<InferRouterInitialContext<typeof router>>().toEqualTypeOf<
      { init1?: boolean } & { init2?: boolean } & { init3?: boolean } & { init4?: boolean }
    >()
  })

  it('InferRouterInitialContexts', () => {
    type Contexts = InferRouterInitialContexts<typeof router>

    expectTypeOf<Contexts['ping']>().toEqualTypeOf<{ init1?: boolean }>()
    expectTypeOf<Contexts['nested']['ping']>().toEqualTypeOf<{ init3?: boolean }>()
    expectTypeOf<Contexts['pong']>().toEqualTypeOf<{ init2?: boolean }>()
    expectTypeOf<Contexts['nested']['pong']>().toEqualTypeOf<{ init4?: boolean }>()
  })

  it('InferRouterCurrentContexts', () => {
    type Contexts = InferRouterFinalContexts<typeof router>

    expectTypeOf<Contexts['ping']>().toEqualTypeOf<{ init1?: boolean }>()
    expectTypeOf<Contexts['nested']['ping']>().toEqualTypeOf<{ init3?: boolean }>()
    expectTypeOf<Contexts['pong']>().toEqualTypeOf<{ init2?: boolean } & { extra: true }>()
    expectTypeOf<Contexts['nested']['pong']>().toEqualTypeOf<
      { init4?: boolean } & { extra: true }
    >()
  })

  it('InferRouterInputs', () => {
    type Inferred = InferRouterInputs<typeof router>

    expectTypeOf<Inferred['ping']>().toEqualTypeOf<{ input: number }>()
    expectTypeOf<Inferred['nested']['ping']>().toEqualTypeOf<{ input: number }>()

    expectTypeOf<Inferred['pong']>().toEqualTypeOf<{ input: string }>()
    expectTypeOf<Inferred['nested']['pong']>().toEqualTypeOf<{ value: boolean }>()
  })

  it('InferRouterOutputs', () => {
    type Inferred = InferRouterOutputs<typeof router>

    expectTypeOf<Inferred['ping']>().toEqualTypeOf<{ output: number }>()
    expectTypeOf<Inferred['nested']['ping']>().toEqualTypeOf<{ value: boolean }>()

    expectTypeOf<Inferred['pong']>().toEqualTypeOf<unknown>()
    expectTypeOf<Inferred['nested']['pong']>().toEqualTypeOf<unknown>()
  })

  const errorRouter = {
    ping: {} as Procedure<
      { init1?: boolean },
      object,
      Schema1,
      Schema2,
      { AUTH: { message: string } }
    >,
    pong: {} as Procedure<{ init2?: boolean }, { extra: true }, Schema2, Schema<unknown>, object>,
    nested: {
      ping: {} as Procedure<
        { init3?: boolean },
        object,
        Schema1,
        Schema3,
        { RATE_LIMITED: { data: Schema<unknown, { retryAfter: number }> } }
      >,
      pong: {} as Procedure<{ init4?: boolean }, { extra: true }, Schema3, Schema<unknown>, object>,
    },
  }

  it('InferRouterErrors', () => {
    type Errors = InferRouterErrors<typeof errorRouter>

    expectTypeOf<Errors['ping']>().toEqualTypeOf<ORPCError<'AUTH', unknown> | ThrowableError>()
    expectTypeOf<Errors['pong']>().toEqualTypeOf<ThrowableError>()
    expectTypeOf<Errors['nested']['ping']>().toEqualTypeOf<
      ORPCError<'RATE_LIMITED', { retryAfter: number }> | ThrowableError
    >()
    expectTypeOf<Errors['nested']['pong']>().toEqualTypeOf<ThrowableError>()
  })

  it('InferRouterError', () => {
    expectTypeOf<InferRouterError<typeof errorRouter>>().toEqualTypeOf<
      | ORPCError<'AUTH', unknown>
      | ORPCError<'RATE_LIMITED', { retryAfter: number }>
      | ThrowableError
    >()
  })

  it('supports lazy and lazyable keys', () => {
    type LazyRouter = { nested: Lazy<typeof errorRouter> }
    type LazyableRouter = { nested: Lazyable<typeof errorRouter> }

    type InitialContexts = InferRouterInitialContexts<typeof errorRouter>
    expectTypeOf<
      InferRouterInitialContexts<LazyRouter>['nested']
    >().toEqualTypeOf<InitialContexts>()
    expectTypeOf<
      InferRouterInitialContexts<LazyableRouter>['nested']
    >().toEqualTypeOf<InitialContexts>()

    type FinalContexts = InferRouterFinalContexts<typeof errorRouter>
    expectTypeOf<InferRouterFinalContexts<LazyRouter>['nested']>().toEqualTypeOf<FinalContexts>()
    expectTypeOf<
      InferRouterFinalContexts<LazyableRouter>['nested']
    >().toEqualTypeOf<FinalContexts>()

    type Inputs = InferRouterInputs<typeof errorRouter>
    expectTypeOf<InferRouterInputs<LazyRouter>['nested']>().toEqualTypeOf<Inputs>()
    expectTypeOf<InferRouterInputs<LazyableRouter>['nested']>().toEqualTypeOf<Inputs>()

    type Outputs = InferRouterOutputs<typeof errorRouter>
    expectTypeOf<InferRouterOutputs<LazyRouter>['nested']>().toEqualTypeOf<Outputs>()
    expectTypeOf<InferRouterOutputs<LazyableRouter>['nested']>().toEqualTypeOf<Outputs>()

    type Errors = InferRouterErrors<typeof errorRouter>
    expectTypeOf<InferRouterErrors<LazyRouter>['nested']>().toEqualTypeOf<Errors>()
    expectTypeOf<InferRouterErrors<LazyableRouter>['nested']>().toEqualTypeOf<Errors>()

    type RouterError = InferRouterError<typeof errorRouter>
    expectTypeOf<InferRouterError<LazyRouter>>().toEqualTypeOf<RouterError>()
    expectTypeOf<InferRouterError<LazyableRouter>>().toEqualTypeOf<RouterError>()
  })
})
