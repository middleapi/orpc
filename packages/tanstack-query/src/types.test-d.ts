import type { MaybeOptionalOptions } from '@orpc/shared'

import type {
  LiveOptionsIn,
  LiveOptionsRest,
  MutationOptionsIn,
  MutationOptionsRest,
  QueryOptionsIn,
  QueryOptionsRest,
  StreamedOptionsIn,
  StreamedOptionsRest,
} from './types'

type OptionalContext = { batch?: boolean }
type RequiredContext = { batch: boolean }
type IndexContext = Record<string, unknown>

describe('options rest types', () => {
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

  it('QueryOptionsRest matches MaybeOptionalOptions', () => {
    type Check<C extends OptionalContext | IndexContext, I> = [
      QueryOptionsRest<C, I, number, Error, number, undefined>,
      MaybeOptionalOptions<QueryOptionsIn<C, I, number, Error, number, undefined>>,
    ]

    expectTypeOf<Check<OptionalContext, string | undefined>[0]>().toEqualTypeOf<
      Check<OptionalContext, string | undefined>[1]
    >()
    expectTypeOf<Check<OptionalContext, string>[0]>().toEqualTypeOf<
      Check<OptionalContext, string>[1]
    >()
    expectTypeOf<Check<RequiredContext, string | undefined>[0]>().toEqualTypeOf<
      Check<RequiredContext, string | undefined>[1]
    >()
    expectTypeOf<Check<IndexContext, undefined>[0]>().toEqualTypeOf<
      Check<IndexContext, undefined>[1]
    >()
  })

  it('StreamedOptionsRest and LiveOptionsRest match MaybeOptionalOptions', () => {
    expectTypeOf<
      StreamedOptionsRest<OptionalContext, string | undefined, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<
        StreamedOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
      >
    >()
    expectTypeOf<
      StreamedOptionsRest<RequiredContext, string | undefined, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<
        StreamedOptionsIn<RequiredContext, string | undefined, number, Error, number, undefined>
      >
    >()
    expectTypeOf<
      LiveOptionsRest<OptionalContext, string | undefined, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<
        LiveOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
      >
    >()
    expectTypeOf<
      LiveOptionsRest<OptionalContext, string, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<LiveOptionsIn<OptionalContext, string, number, Error, number, undefined>>
    >()
  })

  it('MutationOptionsRest matches MaybeOptionalOptions and ignores input', () => {
    expectTypeOf<
      MutationOptionsRest<OptionalContext, string, number, Error, unknown>
    >().toEqualTypeOf<
      MaybeOptionalOptions<MutationOptionsIn<OptionalContext, string, number, Error, unknown>>
    >()
    expectTypeOf<
      MutationOptionsRest<RequiredContext, string, number, Error, unknown>
    >().toEqualTypeOf<
      MaybeOptionalOptions<MutationOptionsIn<RequiredContext, string, number, Error, unknown>>
    >()
    expectTypeOf<MutationOptionsRest<IndexContext, string, number, Error, unknown>>().toEqualTypeOf<
      MaybeOptionalOptions<MutationOptionsIn<IndexContext, string, number, Error, unknown>>
    >()
  })
})
