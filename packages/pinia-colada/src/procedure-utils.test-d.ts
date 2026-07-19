import type { Client } from '@orpc/client'
import type { ORPCErrorFromErrorMap } from '@orpc/contract'
import type { Public } from '@orpc/shared'
import type { UseInfiniteQueryData } from '@pinia/colada'
import type { ProcedureUtils } from './procedure-utils'
import { useInfiniteQuery, useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed } from 'vue'
import z from 'zod'

const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

describe('ProcedureUtils', () => {
  type UtilsInput = { search?: string, cursor?: number } | undefined
  type UtilsOutput = { title: string }[]
  type UtilsError = ORPCErrorFromErrorMap<typeof baseErrorMap>

  const utils = {} as Public<ProcedureUtils<
    { batch?: boolean },
    UtilsInput,
    UtilsOutput,
    UtilsError
  >>

  it('.call', () => {
    expectTypeOf(utils.call).toEqualTypeOf<
      Client<
        { batch?: boolean },
        UtilsInput,
        UtilsOutput,
        UtilsError
      >
    >()
  })

  describe('.queryKey', () => {
    it('returns tagged key & infers correct input type', () => {
      const queryCache = useQueryCache()

      expectTypeOf(
        queryCache.getQueryData(utils.queryKey({ input: { search: 'search' } })),
      ).toEqualTypeOf<UtilsOutput | undefined>()

      utils.queryKey()
      utils.queryKey({})
      utils.queryKey({ key: ['__custom__'] })

      // @ts-expect-error invalid input
      utils.queryKey({ input: 'invalid' })

      const requiredUtils = {} as Public<ProcedureUtils<{ batch?: boolean }, 'input', UtilsOutput, Error>>
      requiredUtils.queryKey({ input: 'input' })
      // @ts-expect-error input is required
      requiredUtils.queryKey()
    })
  })

  describe('.streamedOptions & .liveOptions', () => {
    const streamUtils = {} as Public<ProcedureUtils<
      { batch?: boolean },
      UtilsInput,
      AsyncIterable<UtilsOutput[number]>,
      UtilsError
    >>

    it('works with useQuery', () => {
      const streamed = useQuery(streamUtils.streamedOptions({
        input: { search: 'search' },
        fnOptions: { refetchMode: 'append', maxChunks: 3 },
      }))

      expectTypeOf(streamed.data.value).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(streamed.error.value).toEqualTypeOf<UtilsError | null>()

      const live = useQuery(() => streamUtils.liveOptions({ input: { search: 'search' } }))

      expectTypeOf(live.data.value).toEqualTypeOf<UtilsOutput[number] | undefined>()
      expectTypeOf(live.error.value).toEqualTypeOf<UtilsError | null>()
    })

    it('returns tagged keys', () => {
      const queryCache = useQueryCache()

      expectTypeOf(
        queryCache.getQueryData(streamUtils.streamedKey({ input: { search: 'search' } })),
      ).toEqualTypeOf<UtilsOutput | undefined>()

      expectTypeOf(
        queryCache.getQueryData(streamUtils.liveKey({ input: { search: 'search' } })),
      ).toEqualTypeOf<UtilsOutput[number] | undefined>()
    })

    it('infer correct input & fnOptions types', () => {
      // @ts-expect-error invalid input
      streamUtils.streamedOptions({ input: 'invalid' })
      // @ts-expect-error invalid fnOptions
      streamUtils.streamedOptions({ fnOptions: { refetchMode: 'invalid' } })
      // @ts-expect-error invalid input
      streamUtils.liveOptions({ input: 'invalid' })
    })
  })

  describe('.infiniteKey', () => {
    it('returns tagged key & infers correct input type', () => {
      const queryCache = useQueryCache()

      expectTypeOf(
        queryCache.getQueryData(utils.infiniteKey({ input: (cursor: number) => ({ cursor }), initialPageParam: 0 })),
      ).toEqualTypeOf<UseInfiniteQueryData<UtilsOutput, number> | undefined>()

      utils.infiniteKey({ key: ['__custom__'] })

      utils.infiniteKey({
        // @ts-expect-error invalid input
        input: (cursor: number) => ({ cursor: 'invalid' }),
        initialPageParam: 0,
      })
    })
  })

  describe('.mutationKey', () => {
    it('works', () => {
      const key = utils.mutationKey()

      if (typeof key === 'function') {
        expectTypeOf(key).parameter(0).toEqualTypeOf<UtilsInput>()
      }

      utils.mutationKey({})
      utils.mutationKey({ key: ['__custom__'] })
      utils.mutationKey({ key: input => [{ input }] as any })
    })
  })

  describe('.queryOptions', () => {
    it('can optional options', () => {
      const requiredUtils = {} as Public<ProcedureUtils<{ batch?: boolean }, 'input', UtilsOutput, Error>>

      utils.queryOptions()
      utils.queryOptions({ context: { batch: true } })
      utils.queryOptions({ input: { search: 'search' } })

      requiredUtils.queryOptions({
        context: { batch: true },
        input: 'input',
      })
      // @ts-expect-error input and context is required
      requiredUtils.queryOptions()
      // @ts-expect-error input and context is required
      requiredUtils.queryOptions({})
      // @ts-expect-error input is required
      requiredUtils.queryOptions({ context: { batch: true } })
    })

    it('infer correct input type', () => {
      utils.queryOptions({ input: { cursor: 1 }, context: { batch: true } })
      // @ts-expect-error invalid input
      utils.queryOptions({ input: { cursor: 'invalid' }, context: { batch: true } })
    })

    it('infer correct context type', () => {
      utils.queryOptions({ context: { batch: true } })
      // @ts-expect-error invalid context
      utils.queryOptions({ context: { batch: 'invalid' } })
    })

    it('not allow ref/computed values, reactivity via useQuery callback instead', () => {
      // @ts-expect-error ref/computed input is not allowed
      utils.queryOptions({ input: computed(() => ({ cursor: 1 })) })
      // @ts-expect-error getter input is not allowed
      utils.queryOptions({ input: () => ({ cursor: 1 }) })
      // @ts-expect-error ref/computed context is not allowed
      utils.queryOptions({ context: computed(() => ({ batch: true })) })

      const query = useQuery(() => utils.queryOptions({ input: { cursor: 1 } }))

      expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
    })

    describe('works with useQuery', () => {
      it('without initial data', () => {
        const query = useQuery(utils.queryOptions())

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data', () => {
        const query = useQuery(utils.queryOptions({
          initialData: () => [{ title: 'title' }],
        }))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })
    })
  })

  describe('.infiniteOptions', () => {
    it('infer correct input & page param types', () => {
      utils.infiniteOptions({
        input: (cursor: number) => ({ cursor }),
        initialPageParam: 0,
        getNextPageParam: (lastPage) => {
          expectTypeOf(lastPage).toEqualTypeOf<UtilsOutput>()
          return 1
        },
      })

      utils.infiniteOptions({
        // @ts-expect-error invalid input
        input: (cursor: number) => ({ cursor: 'invalid' }),
        initialPageParam: 0,
        getNextPageParam: () => 1,
      })

      // @ts-expect-error initialPageParam & getNextPageParam are required
      utils.infiniteOptions({
        input: (cursor: number) => ({ cursor }),
      })
    })

    it('infer correct context type', () => {
      utils.infiniteOptions({
        input: () => undefined,
        initialPageParam: 0,
        getNextPageParam: () => 1,
        context: { batch: true },
      })

      utils.infiniteOptions({
        input: () => undefined,
        initialPageParam: 0,
        getNextPageParam: () => 1,
        // @ts-expect-error invalid context
        context: { batch: 'invalid' },
      })
    })

    it('works with useInfiniteQuery', () => {
      const query = useInfiniteQuery(utils.infiniteOptions({
        input: (cursor: number) => ({ cursor }),
        initialPageParam: 0,
        getNextPageParam: () => 1,
      }))

      expectTypeOf(query.data.value?.pages).toEqualTypeOf<UtilsOutput[] | undefined>()
      expectTypeOf(query.data.value?.pageParams).toEqualTypeOf<number[] | undefined>()
      expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()

      const lazyQuery = useInfiniteQuery(() => utils.infiniteOptions({
        input: (cursor: number) => ({ cursor }),
        initialPageParam: 0,
        getNextPageParam: () => 1,
      }))

      expectTypeOf(lazyQuery.data.value?.pages).toEqualTypeOf<UtilsOutput[] | undefined>()
    })
  })

  describe('.mutationOptions', () => {
    it('can optional options', () => {
      const requiredUtils = {} as Public<ProcedureUtils<{ batch: boolean }, 'input', UtilsOutput, Error>>

      utils.mutationOptions()
      utils.mutationOptions({})

      requiredUtils.mutationOptions({
        context: { batch: true },
      })
      // @ts-expect-error context is required
      requiredUtils.mutationOptions()
      // @ts-expect-error context is required
      requiredUtils.mutationOptions({})
    })

    it('infer correct context type', () => {
      utils.mutationOptions({ context: { batch: true } })
      // @ts-expect-error invalid context
      utils.mutationOptions({ context: { batch: 'invalid' } })
    })

    it('not allow ref/computed context', () => {
      // @ts-expect-error ref/computed context is not allowed
      utils.mutationOptions({ context: computed(() => ({ batch: true })) })
      // @ts-expect-error getter context is not allowed
      utils.mutationOptions({ context: () => ({ batch: true }) })
    })

    it('works with useMutation', () => {
      const mutation = useMutation(utils.mutationOptions({
        onSuccess: (data, input) => {
          expectTypeOf(data).toEqualTypeOf<UtilsOutput>()
          expectTypeOf(input).toEqualTypeOf<UtilsInput>()
        },
        onError: (error) => {
          expectTypeOf(error).toEqualTypeOf<UtilsError>()
        },
      }))

      expectTypeOf<Parameters<typeof mutation.mutate>[0]>().toEqualTypeOf<UtilsInput>()
      expectTypeOf(mutation.data.value).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(mutation.error.value).toEqualTypeOf<UtilsError | null>()
    })

    it('infer correct mutation context type', () => {
      useMutation({
        ...utils.mutationOptions({
          onMutate: () => ({ mutationContext: true }),
          onError: (e, v, context) => {
            expectTypeOf(context.mutationContext).toEqualTypeOf<undefined | boolean>()
          },
        }),
        onSettled: (d, e, v, context) => {
          expectTypeOf(context.mutationContext).toEqualTypeOf<undefined | boolean>()
        },
      })
    })
  })
})
