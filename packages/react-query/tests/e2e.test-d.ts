import type { InfiniteData } from '@tanstack/react-query'
import { useInfiniteQuery, useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { orpc, queryClient } from './helpers'

beforeEach(() => {
  queryClient.clear()
})

describe('useQuery', () => {
  it('infer types correctly', async () => {
    const query = useQuery(orpc.user.find.queryOptions({
      input: { id: '123' },
      select(data) {
        expectTypeOf(data).toEqualTypeOf<{ id: string, name: string }>()

        return data
      },
    }), queryClient)

    expectTypeOf(query.data).toEqualTypeOf<{ id: string, name: string } | undefined>()
  })

  it('strict on input', () => {
    // @ts-expect-error options is required since input is required
    useQuery(orpc.user.find.queryOptions())
    // @ts-expect-error input is required
    useQuery(orpc.user.find.queryOptions({}))
    // @ts-expect-error input is invalid
    useQuery(orpc.user.find.queryOptions({ input: { id: 123 } }))
  })

  it('infer types correctly with client context', async () => {
    useQuery(orpc.user.find.queryOptions({ input: { id: '123' } }))
    useQuery(orpc.user.find.queryOptions({ input: { id: '123' }, context: { batch: true } }))
    // @ts-expect-error --- invalid context
    useQuery(orpc.user.find.queryOptions({ input: { id: '123' }, context: { batch: 'invalid' } }))
  })
})

describe('useInfiniteQuery', () => {
  it('infer types correctly', async () => {
    const query = useInfiniteQuery(orpc.user.list.infiniteOptions({
      input: {},
      getNextPageParam: lastPage => lastPage.nextCursor,
      select(data) {
        expectTypeOf(data).toMatchTypeOf<InfiniteData<{
          nextCursor: number
          users: {
            id: string
            name: string
          }[]
        }, number | undefined>>()

        return data
      },
    }), queryClient)

    expectTypeOf(query.data).toMatchTypeOf<InfiniteData<{
      nextCursor: number
      users: {
        id: string
        name: string
      }[]
    }, number | undefined> | undefined>()
  })

  it('cannot use on un cursor procedure', () => {
    // @ts-expect-error initialPageParam is required
    useInfiniteQuery(orpc.user.find.infiniteOptions({
      input: {} as any,
      getNextPageParam: {} as any,
    }))

    useInfiniteQuery(orpc.user.find.infiniteOptions({
      input: {} as any,
      getNextPageParam: {} as any,
      initialPageParam: {} as never, // required but must be never so cannot use this procedure
    }))
  })

  it('strict on input', () => {
    useInfiniteQuery(orpc.user.list.infiniteOptions({
      input: { keyword: 'keyword' },
      getNextPageParam: {} as any,
    }))

    // @ts-expect-error input is invalid
    useInfiniteQuery(orpc.user.list.infiniteOptions({
      // @ts-expect-error input is invalid
      input: { keyword: 1234 },
      getNextPageParam: {} as any,
    }))
  })

  it('infer types correctly with client context', async () => {
    useInfiniteQuery(orpc.user.list.infiniteOptions({
      input: { keyword: 'keyword' },
      getNextPageParam: {} as any,
    }))
    useInfiniteQuery(orpc.user.list.infiniteOptions({
      input: { keyword: 'keyword' },
      getNextPageParam: {} as any,
      context: { batch: true },
    }))
    // @ts-expect-error --- invalid context
    useInfiniteQuery(orpc.user.list.infiniteOptions({
      input: { keyword: 'keyword' },
      getNextPageParam: {} as any,
      // @ts-expect-error --- invalid context
      context: { batch: 'invalid' },
    }))
  })
})

describe('useMutation', () => {
  it('infer types correctly', async () => {
    const query = useMutation(orpc.user.find.mutationOptions({
      onSuccess(data) {
        expectTypeOf(data).toEqualTypeOf<{ id: string, name: string }>()
      },
    }), queryClient)

    expectTypeOf(query.data).toEqualTypeOf<{ id: string, name: string } | undefined>()

    expectTypeOf(query.mutateAsync).toMatchTypeOf<(input: { id: string }) => Promise<{ id: string, name: string }>>()
  })

  it('infer types correctly with client context', async () => {
    useMutation(orpc.user.find.mutationOptions(({})))
    useMutation(orpc.user.find.mutationOptions(({ context: { batch: true } })))
    // @ts-expect-error --- invalid context
    useMutation(orpc.user.find.mutationOptions(({ context: { batch: 'invalid' } })))
  })
})

describe('useQueries', () => {
  it('inter types correctly', async () => {
    const queries = useQueries({
      queries: [
        orpc.user.find.queryOptions({
          input: { id: '0' },
        }),
        orpc.user.list.queryOptions({
          input: {},
        }),
      ],
      combine(result) {
        expectTypeOf(result[0].data).toEqualTypeOf<{ id: string, name: string } | undefined>()
        expectTypeOf(result[1].data).toEqualTypeOf<{
          nextCursor: number
          users: {
            id: string
            name: string
          }[]
        } | undefined>()

        return result
      },
    }, queryClient)

    expectTypeOf(queries[0].data).toEqualTypeOf<{ id: string, name: string } | undefined>()
    expectTypeOf(queries[1].data).toEqualTypeOf<{
      nextCursor: number
      users: {
        id: string
        name: string
      }[]
    } | undefined>()
  })

  it('TODO: not work with select yet', () => {
    useQueries({
      queries: [
        orpc.user.find.queryOptions({
          input: { id: '0' },
          // @ts-expect-error --- TODO: not work with select yet
          select(data) { return data },
        }),
      ],
    })
  })

  it('strict on input', () => {
    useQueries({ queries: [
      orpc.user.find.queryOptions({
        input: { id: '0' },
      }),
    ] })

    useQueries({
      queries: [
        orpc.user.find.queryOptions({
          // @ts-expect-error --- input must be a string
          input: { id: 1 },
        }),
      ],
    })
  })

  it('infer types correctly with client context', async () => {
    useQueries({
      queries: [
        orpc.user.find.queryOptions({
          input: { id: '0' },
        }),
        orpc.user.find.queryOptions({
          input: { id: '0' },
          context: { batch: true },
        }),
        orpc.user.find.queryOptions({
          input: { id: '0' },
          // @ts-expect-error --- invalid context
          context: { batch: 'invalid' },
        }),
      ],
    })
  })
})
