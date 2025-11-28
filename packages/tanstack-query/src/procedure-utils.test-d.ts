import type { Client } from '@orpc/client'
import type { ErrorFromErrorMap } from '@orpc/contract'
import type { GetNextPageParamFunction, InfiniteData, InfiniteQueryObserverOptions, MutationObserverOptions, QueryFunction, QueryKey, QueryObserverOptions } from '@tanstack/query-core'
import type { baseErrorMap } from '../../contract/tests/shared'
import type { experimental_ProcedureUtilsDefaults, ProcedureUtils } from './procedure-utils'
import { QueryClient, skipToken } from '@tanstack/query-core'

describe('ProcedureUtils', () => {
  type UtilsInput = { search?: string, cursor?: number } | undefined
  type UtilsOutput = { title: string }[]
  type UtilsError = ErrorFromErrorMap<typeof baseErrorMap>

  const queryClient = new QueryClient()

  const condition = {} as boolean

  const optionalUtils = {} as ProcedureUtils<
    { batch?: boolean },
    UtilsInput,
    UtilsOutput,
    UtilsError
  >

  const requiredUtils = {} as ProcedureUtils<
    { batch: boolean },
    'input',
    UtilsOutput,
    Error
  >

  const streamUtils = {} as ProcedureUtils<
    { batch?: boolean },
    UtilsInput,
    AsyncIterable<UtilsOutput[number]>,
    UtilsError
  >

  it('.call', () => {
    expectTypeOf(optionalUtils.call).toEqualTypeOf<
      Client<{ batch?: boolean }, UtilsInput, UtilsOutput, UtilsError>
    >()
  })

  describe('.queryKey', () => {
    it('should handle optional `input` correctly', () => {
      optionalUtils.queryKey()
      optionalUtils.queryKey({ })
      optionalUtils.queryKey({ input: { search: 'search' } })
    })

    it('should handle required `input` correctly', () => {
      // @ts-expect-error - `input` is required
      requiredUtils.queryKey()
    })

    it('should infer types for `input` correctly', () => {
      optionalUtils.queryKey({ input: { cursor: 1 } })
      // @ts-expect-error - Should error on invalid input type
      optionalUtils.queryKey({ input: { cursor: 'invalid' } })

      requiredUtils.queryKey({ input: 'input' })
      // @ts-expect-error - Should error on invalid input type
      requiredUtils.queryKey({ input: 123 })
    })

    it('allow use skipToken as input', () => {
      optionalUtils.queryKey({ input: condition ? skipToken : { search: 'search' } })
      // @ts-expect-error - invalid input type
      optionalUtils.queryKey({ input: condition ? skipToken : { cursor: 'invalid' } })

      requiredUtils.queryKey({ input: condition ? skipToken : 'input' })
      // @ts-expect-error - invalid input type
      requiredUtils.queryKey({ input: condition ? skipToken : 123 })
    })

    it('allow override query key', () => {
      optionalUtils.queryKey({ queryKey: ['1'] })
      // @ts-expect-error - invalid query key type
      optionalUtils.queryKey({ queryKey: 1 })
    })

    it('return valid query key', () => {
      expectTypeOf(optionalUtils.queryKey()).toExtend<QueryKey>()
      expectTypeOf(optionalUtils.queryKey({ input: { search: 'search' } })).toExtend<QueryKey>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(optionalUtils.queryKey())
      expectTypeOf(state?.data).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.queryOptions', () => {
    it('should handle optional `context` and `input` correctly', () => {
      optionalUtils.queryOptions()
      optionalUtils.queryOptions({ context: { batch: true } })
      optionalUtils.queryOptions({ input: { search: 'search' } })
    })

    it('should handle required `context` and `input` correctly', () => {
      // @ts-expect-error - `input` and `context` are required
      requiredUtils.queryOptions()
      // @ts-expect-error - `input` is required
      requiredUtils.queryOptions({ context: { batch: true } })
      // @ts-expect-error - `context` is required
      requiredUtils.queryOptions({ input: 'input' })
    })

    it('should infer types for `input` and `context` correctly', () => {
      optionalUtils.queryOptions({ input: { cursor: 1 } })
      // @ts-expect-error - Should error on invalid input type
      optionalUtils.queryOptions({ input: { cursor: 'invalid' } })

      optionalUtils.queryOptions({ context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      optionalUtils.queryOptions({ context: { batch: 'invalid' } })

      requiredUtils.queryOptions({ input: 'input', context: { batch: true } })
      // @ts-expect-error - Should error on invalid input type
      requiredUtils.queryOptions({ input: 123, context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      requiredUtils.queryOptions({ input: 'input', context: { batch: 'invalid' } })
    })

    it('allow use skipToken as input', () => {
      optionalUtils.queryOptions({ input: condition ? skipToken : { search: 'search' } })
      // @ts-expect-error - invalid input type
      optionalUtils.queryOptions({ input: condition ? skipToken : { cursor: 'invalid' } })

      requiredUtils.queryOptions({ input: condition ? skipToken : 'input', context: { batch: true } })
      // @ts-expect-error - invalid input type
      requiredUtils.queryOptions({ input: condition ? skipToken : 123, context: { batch: true } })
    })

    it('return valid query options', () => {
      expectTypeOf(optionalUtils.queryOptions()).toExtend<QueryObserverOptions<UtilsOutput, UtilsError>>()
      expectTypeOf(optionalUtils.queryOptions({ context: { batch: true } })).toExtend<QueryObserverOptions<UtilsOutput, UtilsError>>()
      expectTypeOf(requiredUtils.queryOptions({ input: 'input', context: { batch: true } })).toExtend<QueryObserverOptions<UtilsOutput, UtilsError>>()
    })

    it('allow extend and override query options', () => {
      expectTypeOf(optionalUtils.queryOptions({
        queryKey: ['1'], // override
        maxPages: 1, // extend
      })).toExtend<{
        queryKey: string[]
        maxPages: number
        queryFn: QueryFunction<UtilsOutput>
        throwOnError?(error: UtilsError): boolean
        enabled?: boolean
      }>()
    })

    it('can change query data by define select', () => {
      expectTypeOf(optionalUtils.queryOptions({
        select: mapped => ({ mapped }),
      })).toExtend<QueryObserverOptions<UtilsOutput, UtilsError, { mapped: UtilsOutput }>>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(optionalUtils.queryOptions().queryKey)
      expectTypeOf(state?.data).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.streamedKey', () => {
    it('should handle optional `input` correctly', () => {
      optionalUtils.experimental_streamedKey()
      optionalUtils.experimental_streamedKey({})
      optionalUtils.experimental_streamedKey({ input: { search: 'search' } })
    })

    it('should handle required `input` correctly', () => {
      // @ts-expect-error - `input` is required
      requiredUtils.experimental_streamedKey()
    })

    it('should infer types for `input` correctly', () => {
      optionalUtils.experimental_streamedKey({ input: { cursor: 1 } })
      // @ts-expect-error - Should error on invalid input type
      optionalUtils.experimental_streamedKey({ input: { cursor: 'invalid' } })

      requiredUtils.experimental_streamedKey({ input: 'input' })
      // @ts-expect-error - Should error on invalid input type
      requiredUtils.experimental_streamedKey({ input: 123 })
    })

    it('allow use skipToken as input', () => {
      optionalUtils.experimental_streamedKey({ input: condition ? skipToken : { search: 'search' } })
      // @ts-expect-error - invalid input type
      optionalUtils.experimental_streamedKey({ input: condition ? skipToken : { cursor: 'invalid' } })

      requiredUtils.experimental_streamedKey({ input: condition ? skipToken : 'input' })
      // @ts-expect-error - invalid input type
      requiredUtils.experimental_streamedKey({ input: condition ? skipToken : 123 })
    })

    it('allow override query key', () => {
      optionalUtils.experimental_streamedKey({ queryKey: ['1'] })
      // @ts-expect-error - invalid query key type
      optionalUtils.experimental_streamedKey({ queryKey: 1 })
    })

    it('return valid query key', () => {
      expectTypeOf(optionalUtils.experimental_streamedKey()).toExtend<QueryKey>()
      expectTypeOf(optionalUtils.experimental_streamedKey({
        input: { search: 'search' },
        queryFnOptions: {
          maxChunks: 1,
          refetchMode: 'replace',
        },
      })).toExtend<QueryKey>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(streamUtils.experimental_streamedKey())
      expectTypeOf(state?.data).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.streamedOptions', () => {
    it('should handle optional `context` and `input` correctly', () => {
      streamUtils.experimental_streamedOptions()
      streamUtils.experimental_streamedOptions({ context: { batch: true } })
      streamUtils.experimental_streamedOptions({ input: { search: 'search' } })
    })

    it('should handle required `context` and `input` correctly', () => {
      // @ts-expect-error - `input` and `context` are required
      requiredUtils.experimental_streamedOptions()
      // @ts-expect-error - `input` is required
      requiredUtils.experimental_streamedOptions({ context: { batch: true } })
      // @ts-expect-error - `context` is required
      requiredUtils.experimental_streamedOptions({ input: 'input' })
    })

    it('should infer types for `input` and `context` correctly', () => {
      streamUtils.experimental_streamedOptions({ input: { cursor: 1 } })
      // @ts-expect-error - Should error on invalid input type
      streamUtils.experimental_streamedOptions({ input: { cursor: 'invalid' } })

      streamUtils.experimental_streamedOptions({ context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      streamUtils.experimental_streamedOptions({ context: { batch: 'invalid' } })

      requiredUtils.experimental_streamedOptions({ input: 'input', context: { batch: true } })
      // @ts-expect-error - Should error on invalid input type
      requiredUtils.experimental_streamedOptions({ input: 123, context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      requiredUtils.experimental_streamedOptions({ input: 'input', context: { batch: 'invalid' } })
    })

    it('allow use skipToken as input', () => {
      streamUtils.experimental_streamedOptions({ input: condition ? skipToken : { search: 'search' } })
      // @ts-expect-error - invalid input type
      streamUtils.experimental_streamedOptions({ input: condition ? skipToken : { cursor: 'invalid' } })

      requiredUtils.experimental_streamedOptions({ input: condition ? skipToken : 'input', context: { batch: true } })
      // @ts-expect-error - invalid input type
      requiredUtils.experimental_streamedOptions({ input: condition ? skipToken : 123, context: { batch: true } })
    })

    it('return valid streamed options', () => {
      expectTypeOf(streamUtils.experimental_streamedOptions()).toExtend<QueryObserverOptions<UtilsOutput, UtilsError>>()
    })

    it('return invalid streamed options if output is not an async iterable', () => {
      expectTypeOf(optionalUtils.experimental_streamedOptions().queryFn)
        .toEqualTypeOf<QueryFunction<never>>()
    })

    it('allow extend and override streamed options', () => {
      expectTypeOf(streamUtils.experimental_streamedOptions({
        queryKey: ['1'], // override
        maxPages: 1, // extend
      })).toExtend<{
        queryKey: string[]
        maxPages: number
        queryFn: QueryFunction<UtilsOutput>
        throwOnError?(error: UtilsError): boolean
        enabled?: boolean
      }>()
    })

    it('can change streamed data by define select', () => {
      expectTypeOf(streamUtils.experimental_streamedOptions({
        select: mapped => ({ mapped }),
      })).toExtend<QueryObserverOptions<UtilsOutput, UtilsError, { mapped: UtilsOutput }>>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(streamUtils.experimental_streamedOptions().queryKey)
      expectTypeOf(state?.data).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.liveKey', () => {
    it('should handle optional `input` correctly', () => {
      optionalUtils.experimental_liveKey()
      optionalUtils.experimental_liveKey({})
      optionalUtils.experimental_liveKey({ input: { search: 'search' } })
    })

    it('should handle required `input` correctly', () => {
      // @ts-expect-error - `input` is required
      requiredUtils.experimental_liveKey()
    })

    it('should infer types for `input` correctly', () => {
      optionalUtils.experimental_liveKey({ input: { cursor: 1 } })
      // @ts-expect-error - Should error on invalid input type
      optionalUtils.experimental_liveKey({ input: { cursor: 'invalid' } })

      requiredUtils.experimental_liveKey({ input: 'input' })
      // @ts-expect-error - Should error on invalid input type
      requiredUtils.experimental_liveKey({ input: 123 })
    })

    it('allow use skipToken as input', () => {
      optionalUtils.experimental_liveKey({ input: condition ? skipToken : { search: 'search' } })
      // @ts-expect-error - invalid input type
      optionalUtils.experimental_liveKey({ input: condition ? skipToken : { cursor: 'invalid' } })

      requiredUtils.experimental_liveKey({ input: condition ? skipToken : 'input' })
      // @ts-expect-error - invalid input type
      requiredUtils.experimental_liveKey({ input: condition ? skipToken : 123 })
    })

    it('allow override query key', () => {
      optionalUtils.experimental_liveKey({ queryKey: ['1'] })
      // @ts-expect-error - invalid query key type
      optionalUtils.experimental_liveKey({ queryKey: 1 })
    })

    it('return valid query key', () => {
      expectTypeOf(optionalUtils.experimental_liveKey()).toExtend<QueryKey>()
      expectTypeOf(optionalUtils.experimental_liveKey({
        input: { search: 'search' },
      })).toExtend<QueryKey>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(streamUtils.experimental_liveKey())
      expectTypeOf(state?.data).toEqualTypeOf<UtilsOutput[number] | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.liveOptions', () => {
    it('should handle optional `context` and `input` correctly', () => {
      streamUtils.experimental_liveOptions()
      streamUtils.experimental_liveOptions({ context: { batch: true } })
      streamUtils.experimental_liveOptions({ input: { search: 'search' } })
    })

    it('should handle required `context` and `input` correctly', () => {
      // @ts-expect-error - `input` and `context` are required
      requiredUtils.experimental_liveOptions()
      // @ts-expect-error - `input` is required
      requiredUtils.experimental_liveOptions({ context: { batch: true } })
      // @ts-expect-error - `context` is required
      requiredUtils.experimental_liveOptions({ input: 'input' })
    })

    it('should infer types for `input` and `context` correctly', () => {
      streamUtils.experimental_liveOptions({ input: { cursor: 1 } })
      // @ts-expect-error - Should error on invalid input type
      streamUtils.experimental_liveOptions({ input: { cursor: 'invalid' } })

      streamUtils.experimental_liveOptions({ context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      streamUtils.experimental_liveOptions({ context: { batch: 'invalid' } })

      requiredUtils.experimental_liveOptions({ input: 'input', context: { batch: true } })
      // @ts-expect-error - Should error on invalid input type
      requiredUtils.experimental_liveOptions({ input: 123, context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      requiredUtils.experimental_liveOptions({ input: 'input', context: { batch: 'invalid' } })
    })

    it('allow use skipToken as input', () => {
      streamUtils.experimental_liveOptions({ input: condition ? skipToken : { search: 'search' } })
      // @ts-expect-error - invalid input type
      streamUtils.experimental_liveOptions({ input: condition ? skipToken : { cursor: 'invalid' } })

      requiredUtils.experimental_liveOptions({ input: condition ? skipToken : 'input', context: { batch: true } })
      // @ts-expect-error - invalid input type
      requiredUtils.experimental_liveOptions({ input: condition ? skipToken : 123, context: { batch: true } })
    })

    it('return valid streamed options', () => {
      expectTypeOf(streamUtils.experimental_liveOptions()).toExtend<QueryObserverOptions<UtilsOutput[number], UtilsError>>()
    })

    it('return invalid streamed live if output is not an async iterable', () => {
      expectTypeOf(optionalUtils.experimental_liveOptions().queryFn)
        .toEqualTypeOf<QueryFunction<never>>()
    })

    it('allow extend and override live options', () => {
      expectTypeOf(streamUtils.experimental_liveOptions({
        queryKey: ['1'], // override
        maxPages: 1, // extend
      })).toExtend<{
        queryKey: string[]
        maxPages: number
        queryFn: QueryFunction<UtilsOutput[number]>
        throwOnError?(error: UtilsError): boolean
        enabled?: boolean
      }>()
    })

    it('can change live data by define select', () => {
      expectTypeOf(streamUtils.experimental_liveOptions({
        select: mapped => ({ mapped }),
      })).toExtend<QueryObserverOptions<UtilsOutput[number], UtilsError, { mapped: UtilsOutput[number] }>>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(streamUtils.experimental_liveOptions().queryKey)
      expectTypeOf(state?.data).toEqualTypeOf<UtilsOutput[number] | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.infiniteKey', () => {
    const initialPageParam = 1

    it('should infer types for `input` correctly', () => {
      optionalUtils.infiniteKey({
        input: () => ({}),
        initialPageParam,
      })
      optionalUtils.infiniteKey({
        // @ts-expect-error - Should error on invalid input type
        input: () => ({ cursor: 'invalid' }),
        initialPageParam,
      })
    })

    it('allow use skipToken as input', () => {
      optionalUtils.infiniteKey({
        input: condition ? skipToken : () => ({}),
        initialPageParam,
      })
      optionalUtils.infiniteKey({
        // @ts-expect-error - invalid input type
        input: condition ? skipToken : () => ({ cursor: 'invalid' }),
        initialPageParam,
      })
    })

    it('should infer `pageParam` type correctly', () => {
      optionalUtils.infiniteKey({
        input: (pageParam) => {
          expectTypeOf(pageParam).toEqualTypeOf<number>()
          return { cursor: pageParam }
        },
        initialPageParam,
      })

      optionalUtils.infiniteKey({
        input: condition
          ? skipToken
          : (pageParam) => {
              expectTypeOf(pageParam).toEqualTypeOf<number>()
              return { cursor: pageParam }
            },
        initialPageParam,
      })
    })

    it('should error on conflicting `pageParam` types', () => {
      optionalUtils.infiniteKey({
        input: (pageParam: number | undefined) => {
          return { cursor: pageParam }
        },
        initialPageParam,
      })

      optionalUtils.infiniteKey({
        input: condition
          ? skipToken
          : (pageParam: number) => {
              return { cursor: pageParam }
            },
        // @ts-expect-error - conflict pageParam type
        initialPageParam: undefined,
      })
    })

    it('allow override query key', () => {
      optionalUtils.infiniteKey({
        input: () => ({}),
        initialPageParam,
        queryKey: ['1'],
      })
      optionalUtils.infiniteKey({
        input: () => ({}),
        initialPageParam,
        // @ts-expect-error - invalid query key type
        queryKey: 1,
      })
    })

    it('return valid query key', () => {
      expectTypeOf(optionalUtils.infiniteKey({
        input: () => ({}),
        initialPageParam,
      })).toExtend<QueryKey>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(optionalUtils.infiniteKey({
        input: () => ({}),
        initialPageParam,
      }))

      expectTypeOf(state?.data).toEqualTypeOf<InfiniteData<UtilsOutput, number> | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.infiniteOptions', () => {
    const getNextPageParam: GetNextPageParamFunction<number, UtilsOutput> = () => 1
    const initialPageParam = 1

    it('should handle optional/required `context` correctly', () => {
      optionalUtils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam,
      })

      requiredUtils.infiniteOptions({
        context: { batch: true },
        input: () => 'input',
        getNextPageParam,
        initialPageParam,
      })

      // @ts-expect-error - `context` is required
      requiredUtils.infiniteOptions({
        input: () => 'input',
        getNextPageParam,
        initialPageParam,
      })

      // @ts-expect-error - options is required
      requiredUtils.infiniteOptions()
    })

    it('should infer types for `input` and `context` correctly', () => {
      optionalUtils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam,
      })
      optionalUtils.infiniteOptions({
        // @ts-expect-error - Should error on invalid input type
        input: () => ({ cursor: 'invalid' }),
        getNextPageParam,
        initialPageParam,
      })

      requiredUtils.infiniteOptions({
        context: { batch: true },
        input: () => 'input',
        getNextPageParam,
        initialPageParam,
      })
      requiredUtils.infiniteOptions({
        // @ts-expect-error - Should error on invalid context type
        context: { batch: 'invalid' },
        input: () => 'input',
        getNextPageParam,
        initialPageParam,
      })
    })

    it('allow use skipToken as input', () => {
      optionalUtils.infiniteOptions({
        input: condition ? skipToken : () => ({}),
        getNextPageParam,
        initialPageParam,
      })
      optionalUtils.infiniteOptions({
        // @ts-expect-error - invalid input type
        input: condition ? skipToken : () => ({ cursor: 'invalid' }),
        getNextPageParam,
        initialPageParam,
      })
    })

    it('should infer `pageParam` type correctly', () => {
      optionalUtils.infiniteOptions({
        input: (pageParam) => {
          expectTypeOf(pageParam).toEqualTypeOf<number>()
          return { cursor: pageParam }
        },
        getNextPageParam,
        initialPageParam,
      })

      optionalUtils.infiniteOptions({
        input: condition
          ? skipToken
          : (pageParam) => {
              expectTypeOf(pageParam).toEqualTypeOf<number>()
              return { cursor: pageParam }
            },
        getNextPageParam,
        initialPageParam,
      })
    })

    it('should error on conflicting `pageParam` types', () => {
      optionalUtils.infiniteOptions({
        input: (pageParam: number | undefined) => {
          return { cursor: pageParam }
        },
        getNextPageParam,
        initialPageParam,
      })

      optionalUtils.infiniteOptions({
        // @ts-expect-error - conflict pageParam type
        input: condition
          ? skipToken
          : (pageParam: number) => {
              return { cursor: pageParam }
            },
        // @ts-expect-error - conflict pageParam type
        getNextPageParam,
        // @ts-expect-error - conflict pageParam type
        initialPageParam: undefined,
      })
    })

    it('return valid infinite options', () => {
      expectTypeOf(optionalUtils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam,
      })).toExtend<InfiniteQueryObserverOptions<UtilsOutput, UtilsError, InfiniteData<UtilsOutput, number>, QueryKey, number>>()
    })

    it('allow extend and override infinite options', () => {
      expectTypeOf(optionalUtils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam,
        queryKey: ['1'], // override
        maxPages: 1, // extend
      })).toExtend<{
        queryKey: string[]
        maxPages: number
        queryFn: QueryFunction<UtilsOutput>
        throwOnError?(error: UtilsError): boolean
        enabled?: boolean
      }>()
    })

    it('can change infinite data by define select', () => {
      expectTypeOf(optionalUtils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam,
        select: mapped => ({ mapped }),
      })).toExtend<InfiniteQueryObserverOptions<UtilsOutput, UtilsError, { mapped: InfiniteData<UtilsOutput, number> }, QueryKey, number>>()
    })

    it('.getQueryState is typed correctly', () => {
      const state = queryClient.getQueryState(optionalUtils.infiniteOptions({
        input: () => ({}),
        getNextPageParam,
        initialPageParam,
      }).queryKey)

      expectTypeOf(state?.data).toEqualTypeOf<InfiniteData<UtilsOutput, number> | undefined>()
      expectTypeOf(state?.error).toEqualTypeOf<UtilsError | null | undefined>()
    })
  })

  describe('.mutationKey', () => {
    it('should optional arguments', () => {
      optionalUtils.mutationKey()
    })

    it('allow override query key', () => {
      optionalUtils.mutationKey({
        mutationKey: ['1'],
      })
      optionalUtils.mutationKey({
        // @ts-expect-error - invalid query key type
        mutationKey: 1,
      })
    })

    it('return valid query key', () => {
      expectTypeOf(optionalUtils.mutationKey()).toExtend<QueryKey>()
    })
  })

  describe('.mutationOptions', () => {
    it('should handle optional/required `context`', () => {
      optionalUtils.mutationOptions()
      optionalUtils.mutationOptions({})

      requiredUtils.mutationOptions({
        context: { batch: true },
      })
      // @ts-expect-error context is required
      requiredUtils.mutationOptions()
      // @ts-expect-error context is required
      requiredUtils.mutationOptions({})
    })

    it('should infer `context` type correctly', () => {
      optionalUtils.mutationOptions({ context: { batch: true } })
      // @ts-expect-error - Should error on invalid context type
      optionalUtils.mutationOptions({ context: { batch: 'invalid' } })
    })

    it('should infer mutation context type in lifecycle hooks', () => {
      optionalUtils.mutationOptions({
        onMutate: variables => ({ customContext: true }),
        onSuccess: (data, variables, context) => {
          expectTypeOf(context.customContext).toEqualTypeOf<boolean>()
        },
        onError: (e, variables, context) => {
          expectTypeOf(context?.customContext).toEqualTypeOf<boolean | undefined>()
        },
      })
    })

    it('return valid mutation options', () => {
      expectTypeOf(optionalUtils.mutationOptions()).toExtend<MutationObserverOptions<UtilsOutput, UtilsError, UtilsInput>>()
      expectTypeOf(optionalUtils.mutationOptions({
        onMutate: variables => ({ customContext: true }),
      })).toExtend<MutationObserverOptions<UtilsOutput, UtilsError, UtilsInput, { customContext: boolean }>>()
    })
  })
})

describe('ProcedureUtilsDefaults', () => {
  type TestClientContext = { batch?: boolean }
  type TestInput = { search?: string }
  type TestOutput = { title: string }
  type TestError = Error

  type TestDefaults = experimental_ProcedureUtilsDefaults<TestClientContext, TestInput, TestOutput, TestError>

  it('should have exact same keys as ProcedureUtils excluding call', () => {
    // Ensures every utility method in ProcedureUtils (except 'call') has a corresponding key in ProcedureUtilsDefaults
    type ProcedureUtilsKeys = Exclude<keyof ProcedureUtils<any, any, any, any>, 'call'>
    type DefaultsKeys = keyof experimental_ProcedureUtilsDefaults<any, any, any, any>

    expectTypeOf<DefaultsKeys>().toEqualTypeOf<ProcedureUtilsKeys>()
  })

  it('all properties should be optional', () => {
    const emptyDefaults: TestDefaults = {}
    expectTypeOf(emptyDefaults).toExtend<TestDefaults>()
  })

  it('queryKey should accept Partial<QueryKeyOptions>', () => {
    const defaults: TestDefaults = {
      queryKey: {
        input: { search: 'test' },
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      queryKey: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('queryOptions should accept Partial<QueryOptionsIn>', () => {
    const defaults: TestDefaults = {
      queryOptions: {
        input: { search: 'test' },
        staleTime: 1000,
        context: { batch: true },
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      queryOptions: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('experimental_streamedKey should accept Partial<experimental_StreamedKeyOptions>', () => {
    const defaults: TestDefaults = {
      experimental_streamedKey: {
        input: { search: 'test' },
        queryFnOptions: { maxChunks: 10 },
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      experimental_streamedKey: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('experimental_streamedOptions should accept Partial<StreamedOptionsIn>', () => {
    const defaults: TestDefaults = {
      experimental_streamedOptions: {
        input: { search: 'test' },
        staleTime: 1000,
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      experimental_streamedOptions: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('experimental_liveKey should accept Partial<QueryKeyOptions>', () => {
    const defaults: TestDefaults = {
      experimental_liveKey: {
        input: { search: 'test' },
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      experimental_liveKey: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('experimental_liveOptions should accept Partial<StreamedOptionsIn>', () => {
    const defaults: TestDefaults = {
      experimental_liveOptions: {
        input: { search: 'test' },
        staleTime: 1000,
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      experimental_liveOptions: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('infiniteKey should accept Partial input, initialPageParam, queryKey', () => {
    const defaults: TestDefaults = {
      infiniteKey: {
        initialPageParam: 0,
        queryKey: ['custom-key'],
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      infiniteKey: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('infiniteOptions should accept Partial<InfiniteOptionsIn>', () => {
    const defaults: TestDefaults = {
      infiniteOptions: {
        staleTime: 1000,
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      infiniteOptions: {
        // @ts-expect-error - invalid input type
        input: { invalid: 'test' },
      },
    }
  })

  it('mutationKey should accept Partial mutationKey', () => {
    const defaults: TestDefaults = {
      mutationKey: {
        mutationKey: ['custom-mutation-key'],
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      mutationKey: {
        // @ts-expect-error - invalid mutationKey type
        mutationKey: 1,
      },
    }
  })

  it('mutationOptions should accept Partial<MutationOptionsIn>', () => {
    const defaults: TestDefaults = {
      mutationOptions: {
        onSuccess: (output) => {
          expectTypeOf(output).toEqualTypeOf<TestOutput>()
        },
        context: { batch: true },
      },
    }
    expectTypeOf(defaults).toExtend<TestDefaults>()

    const _invalid: TestDefaults = {
      mutationOptions: {
        // @ts-expect-error - invalid context type
        context: { batch: 'invalid' },
      },
    }
  })
})
