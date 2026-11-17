import type { MaybeOptionalOptions } from '@orpc/shared'

import type {
  LiveOptionsIn,
  LiveOptionsInRest,
  MutationOptionsIn,
  MutationOptionsInRest,
  QueryOptionsIn,
  QueryOptionsInRest,
  StreamedOptionsIn,
  StreamedOptionsInRest,
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

  it('QueryOptionsInRest matches MaybeOptionalOptions', () => {
    type Check<C extends OptionalContext | IndexContext, I> = [
      QueryOptionsInRest<C, I, number, Error, number, undefined>,
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

  it('StreamedOptionsInRest and LiveOptionsInRest match MaybeOptionalOptions', () => {
    expectTypeOf<
      StreamedOptionsInRest<OptionalContext, string | undefined, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<
        StreamedOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
      >
    >()
    expectTypeOf<
      StreamedOptionsInRest<RequiredContext, string | undefined, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<
        StreamedOptionsIn<RequiredContext, string | undefined, number, Error, number, undefined>
      >
    >()
    expectTypeOf<
      LiveOptionsInRest<OptionalContext, string | undefined, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<
        LiveOptionsIn<OptionalContext, string | undefined, number, Error, number, undefined>
      >
    >()
    expectTypeOf<
      LiveOptionsInRest<OptionalContext, string, number, Error, number, undefined>
    >().toEqualTypeOf<
      MaybeOptionalOptions<LiveOptionsIn<OptionalContext, string, number, Error, number, undefined>>
    >()
  })

  it('MutationOptionsInRest matches MaybeOptionalOptions and ignores input', () => {
    expectTypeOf<
      MutationOptionsInRest<OptionalContext, string, number, Error, unknown>
    >().toEqualTypeOf<
      MaybeOptionalOptions<MutationOptionsIn<OptionalContext, string, number, Error, unknown>>
    >()
    expectTypeOf<
      MutationOptionsInRest<RequiredContext, string, number, Error, unknown>
    >().toEqualTypeOf<
      MaybeOptionalOptions<MutationOptionsIn<RequiredContext, string, number, Error, unknown>>
    >()
    expectTypeOf<
      MutationOptionsInRest<IndexContext, string, number, Error, unknown>
    >().toEqualTypeOf<
      MaybeOptionalOptions<MutationOptionsIn<IndexContext, string, number, Error, unknown>>
    >()
  })
})
