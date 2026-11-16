import type { MaybeOptionalOptions } from '@orpc/shared'

import type {
  LiveOptionsIn,
  MutationOptionsIn,
  ProcedureUtilsOptionsRest,
  QueryOptionsIn,
  StreamedOptionsIn,
} from './types'

type OptionalContext = { batch?: boolean }
type RequiredContext = { batch: boolean }

describe('ProcedureUtilsOptionsRest', () => {
  it('only input and context can make options required', () => {
    expectTypeOf<{}>().toExtend<
      QueryOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
    >()
    expectTypeOf<{}>().toExtend<
      StreamedOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
    >()
    expectTypeOf<{}>().toExtend<
      LiveOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
    >()
    expectTypeOf<{}>().toExtend<
      MutationOptionsIn<OptionalContext, string, number, Error, unknown>
    >()
  })

  it('matches MaybeOptionalOptions', () => {
    type Query<TContext extends OptionalContext, TInput> = QueryOptionsIn<
      TContext,
      TInput,
      number,
      Error,
      number,
      undefined
    >

    type Mutation<TContext extends OptionalContext> = MutationOptionsIn<
      TContext,
      string,
      number,
      Error,
      unknown
    >

    expectTypeOf<
      ProcedureUtilsOptionsRest<
        OptionalContext,
        Query<OptionalContext, string | undefined>,
        string | undefined
      >
    >().toEqualTypeOf<MaybeOptionalOptions<Query<OptionalContext, string | undefined>>>()
    expectTypeOf<
      ProcedureUtilsOptionsRest<OptionalContext, Query<OptionalContext, string>, string>
    >().toEqualTypeOf<MaybeOptionalOptions<Query<OptionalContext, string>>>()
    expectTypeOf<
      ProcedureUtilsOptionsRest<
        RequiredContext,
        Query<RequiredContext, string | undefined>,
        string | undefined
      >
    >().toEqualTypeOf<MaybeOptionalOptions<Query<RequiredContext, string | undefined>>>()

    expectTypeOf<
      ProcedureUtilsOptionsRest<OptionalContext, Mutation<OptionalContext>>
    >().toEqualTypeOf<MaybeOptionalOptions<Mutation<OptionalContext>>>()
  })
})
