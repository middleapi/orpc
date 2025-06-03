import type { Client } from '@orpc/client'
import type { ErrorFromErrorMap } from '@orpc/contract'
import type { GetNextPageParamFunction, InfiniteData, InfiniteQueryObserverOptions, MutationObserverOptions, QueryFunction, QueryKey, QueryObserverOptions } from '@tanstack/query-core'
import type { baseErrorMap } from '../../contract/tests/shared'
import type { ProcedureUtils } from './procedure-utils'
import { skipToken } from '@tanstack/query-core'

describe('ProcedureUtils', () => {
  type UtilsInput = { search?: string, cursor?: number } | undefined
  type UtilsOutput = { title: string }[]
  type UtilsError = ErrorFromErrorMap<typeof baseErrorMap>

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
        enabled: boolean
      }>()
    })

    it('can change query data by define select', () => {
      expectTypeOf(optionalUtils.queryOptions({
        select: mapped => ({ mapped }),
      })).toExtend<QueryObserverOptions<UtilsOutput, UtilsError, { mapped: UtilsOutput }>>()
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
        enabled: boolean
      }>()
    })

    it('can change streamed data by define select', () => {
      expectTypeOf(streamUtils.experimental_streamedOptions({
        select: mapped => ({ mapped }),
      })).toExtend<QueryObserverOptions<UtilsOutput, UtilsError, { mapped: UtilsOutput }>>()
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
        enabled: boolean
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
