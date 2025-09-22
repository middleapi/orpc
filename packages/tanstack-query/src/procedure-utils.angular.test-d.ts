import type { GetNextPageParamFunction, InfiniteData } from '@tanstack/angular-query-experimental'
import type { ErrorFromErrorMap } from '../../contract/src/error'
import type { baseErrorMap } from '../../contract/tests/shared'
import type { ProcedureUtils } from './procedure-utils'
import { injectInfiniteQuery, injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental'
import { injectQueries } from '@tanstack/angular-query-experimental/inject-queries-experimental'

describe('ProcedureUtils', () => {
  type UtilsInput = { search?: string, cursor?: number } | undefined
  type UtilsOutput = { title: string }[]
  type UtilsError = ErrorFromErrorMap<typeof baseErrorMap>

  const queryClient = new QueryClient()

  const optionalUtils = {} as ProcedureUtils<
    { batch?: boolean },
    UtilsInput,
    UtilsOutput,
    UtilsError
  >

  const streamUtils = {} as ProcedureUtils<
    { batch?: boolean },
    UtilsInput,
    AsyncIterable<UtilsOutput[number]>,
    UtilsError
  >

  describe('.queryOptions', () => {
    describe('injectQuery', () => {
      it('without args', () => {
        const query = injectQuery(() => optionalUtils.queryOptions())
        expectTypeOf(query.data()).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = injectQuery(() => optionalUtils.queryOptions({
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        }))
        expectTypeOf(query.data()).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = injectQuery(() => optionalUtils.queryOptions({
          select: data => ({ mapped: data }),
          initialData: [{ title: 'title' }],
        }))

        expectTypeOf(query.data()).toEqualTypeOf<{ mapped: UtilsOutput }>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('injectQueries', () => {
      const queries = injectQueries(() => ({
        queries: [
          optionalUtils.queryOptions(),
          optionalUtils.queryOptions({
            input: { search: 'search' },
            context: { batch: true },
          }),
          optionalUtils.queryOptions({
            select: data => ({ mapped: data }),
          }),
        ],
      }))

      expectTypeOf(queries()[0].data()).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(queries()[1].data()).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(queries()[2].data()).toEqualTypeOf<{ mapped: UtilsOutput } | undefined>()

      expectTypeOf(queries()[0].error()).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries()[1].error()).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries()[2].error()).toEqualTypeOf<null | UtilsError>()
    })

    it('fetchQuery', () => {
      expectTypeOf(
        queryClient.fetchQuery(optionalUtils.queryOptions()),
      ).toEqualTypeOf<
        Promise<UtilsOutput>
      >()
    })
  })

  describe('.streamedOptions', () => {
    describe('injectQuery', () => {
      it('without args', () => {
        const query = injectQuery(() => streamUtils.experimental_streamedOptions())
        expectTypeOf(query.data()).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = injectQuery(() => streamUtils.experimental_streamedOptions({
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        }))
        expectTypeOf(query.data()).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = injectQuery(() => streamUtils.experimental_streamedOptions({
          select: data => ({ mapped: data }),
          initialData: [{ title: 'title' }],
        }))

        expectTypeOf(query.data()).toEqualTypeOf<{ mapped: UtilsOutput }>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('injectQueries', () => {
      const queries = injectQueries(() => ({
        queries: [
          streamUtils.experimental_streamedOptions(),
          streamUtils.experimental_streamedOptions({
            input: { search: 'search' },
            context: { batch: true },
          }),
          streamUtils.experimental_streamedOptions({
            select: data => ({ mapped: data }),
          }),
        ],
      }))

      expectTypeOf(queries()[0].data()).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(queries()[1].data()).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(queries()[2].data()).toEqualTypeOf<{ mapped: UtilsOutput } | undefined>()

      expectTypeOf(queries()[0].error()).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries()[1].error()).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries()[2].error()).toEqualTypeOf<null | UtilsError>()
    })

    it('fetchQuery', () => {
      expectTypeOf(
        queryClient.fetchQuery(streamUtils.experimental_streamedOptions()),
      ).toEqualTypeOf<
        Promise<UtilsOutput>
      >()
    })
  })

  describe('.liveOptions', () => {
    describe('injectQuery', () => {
      it('without args', () => {
        const query = injectQuery(() => streamUtils.experimental_liveOptions())
        expectTypeOf(query.data()).toEqualTypeOf<UtilsOutput[number] | undefined>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = injectQuery(() => streamUtils.experimental_liveOptions({
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        }))
        expectTypeOf(query.data()).toEqualTypeOf<UtilsOutput[number] | undefined>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = injectQuery(() => streamUtils.experimental_liveOptions({
          select: data => ({ mapped: data }),
          initialData: { title: 'title' },
        }))

        expectTypeOf(query.data()).toEqualTypeOf<{ mapped: UtilsOutput[number] }>()
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('injectQueries', () => {
      const queries = injectQueries(() => ({
        queries: [
          streamUtils.experimental_liveOptions(),
          streamUtils.experimental_liveOptions({
            input: { search: 'search' },
            context: { batch: true },
          }),
          streamUtils.experimental_liveOptions({
            select: data => ({ mapped: data }),
          }),
        ],
      }))

      expectTypeOf(queries()[0].data()).toEqualTypeOf<UtilsOutput[number] | undefined>()
      expectTypeOf(queries()[1].data()).toEqualTypeOf<UtilsOutput[number] | undefined>()
      expectTypeOf(queries()[2].data()).toEqualTypeOf<{ mapped: UtilsOutput[number] } | undefined>()

      expectTypeOf(queries()[0].error()).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries()[1].error()).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries()[2].error()).toEqualTypeOf<null | UtilsError>()
    })

    it('fetchQuery', () => {
      expectTypeOf(
        queryClient.fetchQuery(streamUtils.experimental_liveOptions()),
      ).toEqualTypeOf<
        Promise<UtilsOutput[number]>
      >()
    })
  })

  describe('.infiniteOptions', () => {
    const getNextPageParam: GetNextPageParamFunction<number, UtilsOutput> = () => 1
    const initialPageParam = 1

    describe('injectInfiniteQuery', () => {
      it('with minimal args', () => {
        const query = injectInfiniteQuery(() => optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
        }))
        expectTypeOf(query.data()).toEqualTypeOf<InfiniteData<UtilsOutput, number> | undefined>()
        // @ts-expect-error - TODO: fix this, seem angular-query injectInfiniteQuery cannot infer error
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = injectInfiniteQuery(() => optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        }))

        expectTypeOf(query.data()).toEqualTypeOf<InfiniteData<UtilsOutput, number> | undefined>()
        // @ts-expect-error - TODO: fix this, seem angular-query injectInfiniteQuery cannot infer error
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = injectInfiniteQuery(() => optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
          select: data => ({ mapped: data }),
          initialData: { pageParams: [], pages: [] },
        }))

        expectTypeOf(query.data()).toEqualTypeOf<{ mapped: InfiniteData<UtilsOutput, number> }>()
        // @ts-expect-error - TODO: fix this, seem angular-query injectInfiniteQuery cannot infer error
        expectTypeOf(query.error()).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('fetchQuery', () => {
      expectTypeOf(
        queryClient.fetchInfiniteQuery(optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
        })),
      ).toEqualTypeOf<
        Promise<InfiniteData<UtilsOutput, number>>
      >()
    })
  })

  describe('.mutationOptions', () => {
    describe('injectMutation', () => {
      it('without args', () => {
        const mutation = injectMutation(() => optionalUtils.mutationOptions())
        expectTypeOf(mutation.data()).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(mutation.error()).toEqualTypeOf<UtilsError | null>()

        mutation.mutate({ cursor: 1 })
        // @ts-expect-error - invalid input
        mutation.mutate({ cursor: 'invalid' })
      })

      it('can infer errors & variables & mutation context inside options', () => {
        const mutation = injectMutation(() => optionalUtils.mutationOptions({
          onMutate: (variables) => {
            expectTypeOf(variables).toEqualTypeOf<UtilsInput>()
            return ({ customContext: true })
          },
          onError: (error, variables, context) => {
            expectTypeOf(context?.customContext).toEqualTypeOf<boolean | undefined>()
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            expectTypeOf(variables).toEqualTypeOf<UtilsInput>()
          },
        }))

        expectTypeOf(mutation.data()).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(mutation.error()).toEqualTypeOf<UtilsError | null>()

        mutation.mutate({ cursor: 1 })
        // @ts-expect-error - invalid input
        mutation.mutate({ cursor: 'invalid' })
      })
    })
  })
})
