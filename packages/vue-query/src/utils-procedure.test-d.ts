import type { ProcedureClient } from '@orpc/server'
import type { InfiniteData, QueryKey } from '@tanstack/vue-query'
import type { ProcedureUtils } from './utils-procedure'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/vue-query'
import { ref } from 'vue'
import { createProcedureUtils } from './utils-procedure'

describe('queryOptions', () => {
  const client = vi.fn <ProcedureClient<number | undefined, string | undefined, undefined>>(
    (...[input]) => Promise.resolve(input?.toString()),
  )
  const utils = createProcedureUtils(client, [])

  const client2 = {} as ProcedureClient<number, string, undefined>
  const utils2 = createProcedureUtils(client2, [])

  it('infer correct input type', () => {
    utils.queryOptions({ input: 1 })
    utils.queryOptions({ input: ref(1) })
    utils.queryOptions({ input: undefined })
    utils.queryOptions({ input: ref(undefined) })

    // @ts-expect-error invalid input
    utils.queryOptions({ input: '1' })
    // @ts-expect-error invalid input
    utils.queryOptions({ input: ref('1') })
  })

  it('can be called without argument', () => {
    const options = utils.queryOptions()

    expectTypeOf(options.queryKey).toEqualTypeOf<QueryKey>()
    expectTypeOf(options.queryFn).toEqualTypeOf<() => Promise<string | undefined>>()
    // @ts-expect-error invalid is required
    utils2.queryOptions()
  })

  it('infer correct output type', () => {
    const query = useQuery(utils2.queryOptions({ input: 1 }))

    expectTypeOf(query.data.value).toEqualTypeOf<string | undefined>()
  })

  it('work with select options', () => {
    const query = useQuery(utils2.queryOptions({
      input: 1,
      select(data) {
        expectTypeOf(data).toEqualTypeOf<string>()

        return { value: 123 }
      },
    }))

    expectTypeOf(query.data.value).toEqualTypeOf<{ value: number } | undefined>()
  })

  describe('client context', () => {
    it('can be optional', () => {
      const utils = {} as ProcedureUtils<undefined, string, undefined | { batch?: boolean }>
      useQuery(utils.queryOptions())
      useQuery(utils.queryOptions({}))
      useQuery(utils.queryOptions({ context: undefined }))
      useQuery(utils.queryOptions({ context: { batch: true } }))
      useQuery(utils.queryOptions({ context: { batch: ref(true) } }))
      // @ts-expect-error --- invalid context
      useQuery(utils.queryOptions({ context: { batch: 'invalid' } }))
      // @ts-expect-error --- invalid context
      useQuery(utils.queryOptions({ context: { batch: ref('invalid') } }))
    })

    it('required pass context when non-optional', () => {
      const utils = {} as ProcedureUtils<undefined, string, { batch?: boolean }>
      // @ts-expect-error --- missing context
      useQuery(utils.queryOptions())
      // @ts-expect-error --- missing context
      useQuery(utils.queryOptions({}))
      useQuery(utils.queryOptions({ context: { batch: true } }))
      useQuery(utils.queryOptions({ context: { batch: ref(false) } }))
      // @ts-expect-error --- invalid context
      useQuery(utils.queryOptions({ context: { batch: 'invalid' } }))
      // @ts-expect-error --- invalid context
      useQuery(utils.queryOptions({ context: { batch: ref('invalid') } }))
    })
  })
})

describe('infiniteOptions', () => {
  const getNextPageParam = vi.fn()

  it('cannot use on procedure without input object-able', () => {
    const utils = createProcedureUtils({} as ProcedureClient<number, string, undefined>, [])

    // @ts-expect-error missing initialPageParam
    utils.infiniteOptions({
      input: 123,
      getNextPageParam,
    })

    utils.infiniteOptions({
      input: 123,
      getNextPageParam,
      // @ts-expect-error initialPageParam must be never
      initialPageParam: 123,
    })

    utils.infiniteOptions({
      input: 123,
      getNextPageParam,
      initialPageParam: 123 as never,
    })
  })

  it('infer correct input type', () => {
    const utils = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor: number }, string, undefined>, [])

    utils.infiniteOptions({
      input: {
        limit: 1,
      },
      getNextPageParam,
      initialPageParam: 1,
    })
    utils.infiniteOptions({
      input: {
        limit: undefined,
      },
      getNextPageParam,
      initialPageParam: 1,
    })

    utils.infiniteOptions({
      input: {
        limit: ref(1),
      },
      getNextPageParam,
      initialPageParam: 1,
    })
    utils.infiniteOptions({
      input: {
        limit: undefined,
      },
      getNextPageParam,
      initialPageParam: 1,
    })

    utils.infiniteOptions({
      input: {
        // @ts-expect-error invalid input
        limit: 'string',
        // cursor will be ignored
        cursor: {},
      },
      getNextPageParam,
      initialPageParam: 1,
    })
  })

  it('infer correct initialPageParam type', () => {
    const utils = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor: number }, string, undefined>, [])

    utils.infiniteOptions({
      input: {},
      getNextPageParam,
      initialPageParam: 1,
    })

    utils.infiniteOptions({
      input: {},
      getNextPageParam,
      initialPageParam: ref(1),
    })

    utils.infiniteOptions({
      input: {},
      getNextPageParam,
      // @ts-expect-error initialPageParam must be number
      initialPageParam: '234',
    })

    utils.infiniteOptions({
      input: {},
      getNextPageParam,
      // @ts-expect-error initialPageParam must be number
      initialPageParam: ref('234'),
    })

    // @ts-expect-error initialPageParam is required
    utils.infiniteOptions({
      input: {},
      getNextPageParam,
    })
  })

  it('initialPageParam can be optional', () => {
    const utils = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor?: number }, string, undefined>, [])

    utils.infiniteOptions({
      input: {},
      getNextPageParam,
    })

    const utils2 = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor: number }, string, undefined>, [])

    // @ts-expect-error initialPageParam is required
    utils2.infiniteOptions({
      input: {},
      getNextPageParam,
    })
  })

  it('input can be optional', () => {
    const utils = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor?: number } | undefined, string, undefined>, [])

    utils.infiniteOptions({
      getNextPageParam,
    })

    const utils2 = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor?: number }, string, undefined>, [])

    // @ts-expect-error input is required
    utils2.infiniteOptions({
      getNextPageParam,
    })
  })

  it('infer correct output type', () => {
    const utils = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor: number }, string, undefined>, [])
    const query = useInfiniteQuery(utils.infiniteOptions({
      input: {
        limit: 1,
      },
      getNextPageParam: () => 1,
      initialPageParam: 1,
    }))

    expectTypeOf(query.data.value).toEqualTypeOf<InfiniteData<string, unknown> | undefined>()
  })

  it('work with select options', () => {
    const utils = createProcedureUtils({} as ProcedureClient<{ limit?: number, cursor: number }, string, undefined>, [])
    const query = useInfiniteQuery(utils.infiniteOptions({
      input: {
        limit: ref(1),
      },
      getNextPageParam,
      initialPageParam: 1,
      select(data) {
        expectTypeOf(data).toEqualTypeOf<InfiniteData<string, number>>()

        return { value: 123 }
      },
    }))

    expectTypeOf(query.data.value).toEqualTypeOf<{ value: number } | undefined>()
  })

  describe('client context', () => {
    it('can be optional', () => {
      const utils = {} as ProcedureUtils<undefined | { limit?: number, cursor: number }, string, undefined | { batch?: boolean }>

      const getNextPageParam = vi.fn()
      const initialPageParam = 1

      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam }))
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: undefined }))
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: true } }))
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: ref(false) } }))
      // @ts-expect-error --- invalid context
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: 'invalid' } }))
      // @ts-expect-error --- invalid context
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: ref('invalid') } }))
    })

    it('required pass context when non-optional', () => {
      const utils = {} as ProcedureUtils<undefined | { limit?: number, cursor: number }, string, { batch?: boolean }>

      const getNextPageParam = vi.fn()
      const initialPageParam = 1

      // @ts-expect-error --- missing context
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam }))
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: true } }))
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: ref(false) } }))
      // @ts-expect-error --- invalid context
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: 'invalid' } }))
      // @ts-expect-error --- invalid context
      useInfiniteQuery(utils.infiniteOptions({ getNextPageParam, initialPageParam, context: { batch: ref('invalid') } }))
    })
  })
})

describe('mutationOptions', () => {
  const client = {} as ProcedureClient<number, string, undefined>
  const utils = createProcedureUtils(client, [])

  it('infer correct input type', () => {
    const option = utils.mutationOptions({
      onSuccess: (data, input) => {
        expectTypeOf(input).toEqualTypeOf<number>()
      },
    })

    option.mutationFn!(1)

    // @ts-expect-error invalid input
    option.mutationFn!('1')
    // @ts-expect-error invalid input
    option.mutationFn!()
  })

  it('infer correct output type', () => {
    const option = utils.mutationOptions({
      onSuccess: (data, input) => {
        expectTypeOf(input).toEqualTypeOf<number>()
        expectTypeOf(data).toEqualTypeOf<string>()
      },
    })

    expectTypeOf(option.mutationFn).toEqualTypeOf<(input: number) => Promise<string>>()
  })

  it('can be called without argument', () => {
    const option = utils.mutationOptions()

    expectTypeOf(option.mutationKey).toEqualTypeOf<QueryKey>()
    expectTypeOf(option.mutationFn).toMatchTypeOf<(input: number) => Promise<string>>()
  })

  describe('client context', () => {
    it('can be optional', () => {
      const utils = {} as ProcedureUtils<undefined, string, undefined | { batch?: boolean }>
      useMutation(utils.mutationOptions())
      useMutation(utils.mutationOptions({}))
      useMutation(utils.mutationOptions({ context: undefined }))
      useMutation(utils.mutationOptions({ context: { batch: true } }))
      useMutation(utils.mutationOptions({ context: { batch: ref(false) } }))
      // @ts-expect-error --- invalid context
      useMutation(utils.mutationOptions({ context: { batch: 'invalid' } }))
      // @ts-expect-error --- invalid context
      useMutation(utils.mutationOptions({ context: { batch: ref('invalid') } }))
    })

    it('required pass context when non-optional', () => {
      const utils = {} as ProcedureUtils<undefined, string, { batch?: boolean }>
      // @ts-expect-error --- missing context
      useMutation(utils.mutationOptions())
      // @ts-expect-error --- missing context
      useMutation(utils.mutationOptions({}))
      useMutation(utils.mutationOptions({ context: { batch: true } }))
      useMutation(utils.mutationOptions({ context: { batch: ref(false) } }))
      // @ts-expect-error --- invalid context
      useMutation(utils.mutationOptions({ context: { batch: 123 } }))
      // @ts-expect-error --- invalid context
      useMutation(utils.mutationOptions({ context: { batch: ref(123) } }))
    })
  })
})
