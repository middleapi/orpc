import type { GetNextPageParamFunction, InfiniteData } from '@tanstack/vue-query'
import type { ErrorFromErrorMap } from '../../contract/src/error'
import type { baseErrorMap } from '../../contract/tests/shared'
import type { ProcedureUtils } from './procedure-utils'
import { QueryClient, useInfiniteQuery, useMutation, useQueries, useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'

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
    describe('useQuery', () => {
      it('without args', () => {
        const query = useQuery(computed(() => optionalUtils.queryOptions()))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = useQuery(computed(() => optionalUtils.queryOptions({
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        })))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = useQuery(computed(() => optionalUtils.queryOptions({
          select: data => ({ mapped: data }),
          initialData: [{ title: 'title' }],
        })))

        // @ts-expect-error - TODO: fix this, seem vue-query do not understand initialData
        expectTypeOf(query.data.value).toEqualTypeOf<{ mapped: UtilsOutput }>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('useQueries', () => {
      const queries = useQueries({
        queries: [
          computed(() => optionalUtils.queryOptions()),
          computed(() => optionalUtils.queryOptions({
            input: { search: 'search' },
            context: { batch: true },
          })),
          // TODO: fix this, cannot define select inside computed
          // computed(() => optionalUtils.queryOptions({
          //   select: data => ({ mapped: data }),
          // })),
        ],
      })

      expectTypeOf(queries.value[0].data).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(queries.value[1].data).toEqualTypeOf<UtilsOutput | undefined>()
      // expectTypeOf(queries.value[2].data).toEqualTypeOf<{ mapped: UtilsOutput } | undefined>()

      expectTypeOf(queries.value[0].error).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries.value[1].error).toEqualTypeOf<null | UtilsError>()
      // expectTypeOf(queries.value[2].error).toEqualTypeOf<null | UtilsError>()
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
    describe('useQuery', () => {
      it('without args', () => {
        const query = useQuery(computed(() => streamUtils.experimental_streamedOptions()))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = useQuery(computed(() => streamUtils.experimental_streamedOptions({
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        })))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = useQuery(computed(() => streamUtils.experimental_streamedOptions({
          select: data => ({ mapped: data }),
          initialData: [{ title: 'title' }],
        })))

        // @ts-expect-error - TODO: fix this, seem vue-query do not understand initialData
        expectTypeOf(query.data.value).toEqualTypeOf<{ mapped: UtilsOutput }>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('useQueries', () => {
      const queries = useQueries({
        queries: [
          computed(() => streamUtils.experimental_streamedOptions()),
          computed(() => streamUtils.experimental_streamedOptions({
            input: { search: 'search' },
            context: { batch: true },
          })),
          // TODO: fix this, cannot define select inside computed
          // computed(() => streamUtils.experimental_streamedOptions({
          //   select: data => ({ mapped: data }),
          // })),
        ],
      })

      expectTypeOf(queries.value[0].data).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(queries.value[1].data).toEqualTypeOf<UtilsOutput | undefined>()
      // expectTypeOf(queries.value[2].data).toEqualTypeOf<{ mapped: UtilsOutput } | undefined>()

      expectTypeOf(queries.value[0].error).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries.value[1].error).toEqualTypeOf<null | UtilsError>()
      // expectTypeOf(queries.value[2].error).toEqualTypeOf<null | UtilsError>()
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
    describe('useQuery', () => {
      it('without args', () => {
        const query = useQuery(computed(() => streamUtils.experimental_liveOptions()))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput[number] | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = useQuery(computed(() => streamUtils.experimental_liveOptions({
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        })))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput[number] | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = useQuery(computed(() => streamUtils.experimental_liveOptions({
          select: data => ({ mapped: data }),
          initialData: { title: 'title' },
        })))

        // @ts-expect-error - TODO: fix this, seem vue-query do not understand initialData
        expectTypeOf(query.data.value).toEqualTypeOf<{ mapped: UtilsOutput[number] }>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })
    })

    it('useQueries', () => {
      const queries = useQueries({
        queries: [
          computed(() => streamUtils.experimental_liveOptions()),
          computed(() => streamUtils.experimental_liveOptions({
            input: { search: 'search' },
            context: { batch: true },
          })),
          // TODO: fix this, cannot define select inside computed
          // computed(() => streamUtils.experimental_liveOptions({
          //   select: data => ({ mapped: data }),
          // })),
        ],
      })

      expectTypeOf(queries.value[0].data).toEqualTypeOf<UtilsOutput[number] | undefined>()
      expectTypeOf(queries.value[1].data).toEqualTypeOf<UtilsOutput[number] | undefined>()
      // expectTypeOf(queries.value[2].data).toEqualTypeOf<{ mapped: UtilsOutput[number] } | undefined>()

      expectTypeOf(queries.value[0].error).toEqualTypeOf<null | UtilsError>()
      expectTypeOf(queries.value[1].error).toEqualTypeOf<null | UtilsError>()
      // expectTypeOf(queries.value[2].error).toEqualTypeOf<null | UtilsError>()
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

    describe('useInfiniteQuery', () => {
      it('with minimal args', () => {
        const query = useInfiniteQuery(computed(() => optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
        })))

        expectTypeOf(query.data.value).toEqualTypeOf<InfiniteData<UtilsOutput, number> | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('can infer errors inside options', () => {
        const query = useInfiniteQuery(computed(() => optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
          throwOnError(error) {
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            return false
          },
        })))

        expectTypeOf(query.data.value).toEqualTypeOf<InfiniteData<UtilsOutput, number> | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data & select', () => {
        const query = useInfiniteQuery(computed(() => optionalUtils.infiniteOptions({
          input: () => ({}),
          getNextPageParam,
          initialPageParam,
          select: data => ({ mapped: data }),
          initialData: { pageParams: [], pages: [] },
        })))

        // @ts-expect-error - TODO: fix TS, seem vue-query do not understand initialData
        expectTypeOf(query.data.value).toEqualTypeOf<{ mapped: InfiniteData<UtilsOutput, number> }>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
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
    describe('useMutation', () => {
      it('without args', () => {
        const mutation = useMutation(computed(() => optionalUtils.mutationOptions()))

        expectTypeOf(mutation.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(mutation.error.value).toEqualTypeOf<UtilsError | null>()

        mutation.mutate({ cursor: 1 })
        // @ts-expect-error - invalid input
        mutation.mutate({ cursor: 'invalid' })
      })

      it('can infer errors & variables & mutation context inside options', () => {
        const mutation = useMutation(computed(() => optionalUtils.mutationOptions({
          onMutate: (variables) => {
            expectTypeOf(variables).toEqualTypeOf<UtilsInput>()
            return ({ customContext: true })
          },
          onError: (error, variables, context) => {
            expectTypeOf(context?.customContext).toEqualTypeOf<boolean | undefined>()
            expectTypeOf(error).toEqualTypeOf<UtilsError>()
            expectTypeOf(variables).toEqualTypeOf<UtilsInput>()
          },
        })))

        expectTypeOf(mutation.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(mutation.error.value).toEqualTypeOf<UtilsError | null>()

        mutation.mutate({ cursor: 1 })
        // @ts-expect-error - invalid input
        mutation.mutate({ cursor: 'invalid' })
      })
    })
  })
})
