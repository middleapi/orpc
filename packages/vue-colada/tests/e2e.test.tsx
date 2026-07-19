import { isInferableError, ORPCError } from '@orpc/client'
import { defineInfiniteQueryOptions, defineQueryOptions, useInfiniteQuery, useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { defineComponent, ref } from 'vue'
import { createORPCVueColadaUtils, VUE_COLADA_OPERATION_CONTEXT_SYMBOL } from '../src'
import { client, mount, orpc, router } from './__shared__/orpc'

beforeEach(() => {
  vi.clearAllMocks()
})

it('case: call directly', async () => {
  expect(await orpc.ping.call({ input: 123 })).toEqual({ output: '123' })
})

it('case: with useQuery', async () => {
  const pingQueryOptions = defineQueryOptions(
    (id: number) => orpc.nested.ping.queryOptions({ input: { input: id } }),
  )

  const mounted = mount(defineComponent({
    setup() {
      const id = ref(123)

      const queryCache = useQueryCache()
      const query = useQuery(() => pingQueryOptions(id.value))

      const setId = (value: number) => {
        id.value = value
      }

      return { query, queryCache, setId }
    },
    render: () => null,
  }))

  // I don't know why but whe should put error case in the top of the test or it will fail by `Unhandled Rejection`
  vi.mocked(router.nested.ping['~orpc'].handler).mockRejectedValueOnce(new ORPCError('OVERRIDE'))
  await vi.waitFor(
    () => expect(mounted.vm.query.error.value).toSatisfy((e: any) => isInferableError(e) && e.code === 'OVERRIDE'),
  )

  mounted.vm.queryCache.invalidateQueries({ key: orpc.ping.key() })
  expect(mounted.vm.query.isLoading.value).toEqual(false)

  mounted.vm.queryCache.invalidateQueries({ key: orpc.nested.pong.key() })
  expect(mounted.vm.query.isLoading.value).toEqual(false)

  mounted.vm.queryCache.invalidateQueries({ key: orpc.nested.key() })
  expect(mounted.vm.query.isLoading.value).toEqual(true)

  await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual({ output: '123' }))

  expect(
    mounted.vm.queryCache.getQueryData(orpc.nested.ping.queryKey({ input: { input: 123 } })),
  ).toEqual({ output: '123' })

  mounted.vm.setId(456)

  await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual({ output: '456' }))
})

it('case: with useInfiniteQuery', async () => {
  const listInfiniteOptions = defineInfiniteQueryOptions(
    () => orpc.list.infiniteOptions({
      input: (cursor: number) => ({ cursor }),
      initialPageParam: 0,
      getNextPageParam: lastPage => lastPage.next,
    }),
  )

  const mounted = mount(defineComponent({
    setup() {
      const queryCache = useQueryCache()
      const query = useInfiniteQuery(() => listInfiniteOptions())

      return { query, queryCache }
    },
    render: () => null,
  }))

  await vi.waitFor(() => expect(mounted.vm.query.data.value?.pages).toEqual([
    { items: ['item-0'], next: 1 },
  ]))

  expect(mounted.vm.query.hasNextPage.value).toEqual(true)

  await mounted.vm.query.loadNextPage()
  await mounted.vm.query.loadNextPage()

  await vi.waitFor(() => expect(mounted.vm.query.data.value?.pages).toEqual([
    { items: ['item-0'], next: 1 },
    { items: ['item-1'], next: 2 },
    { items: ['item-2'], next: null },
  ]))

  expect(mounted.vm.query.hasNextPage.value).toEqual(false)

  expect(
    mounted.vm.queryCache.getQueryData(orpc.list.infiniteKey({ input: (cursor: number) => ({ cursor }), initialPageParam: 0 })),
  ).toEqual({
    pages: [
      { items: ['item-0'], next: 1 },
      { items: ['item-1'], next: 2 },
      { items: ['item-2'], next: null },
    ],
    pageParams: [0, 1, 2],
  })
})

it('case: with useMutation', async () => {
  const mounted = mount(defineComponent({
    setup() {
      const mutation = useMutation(orpc.nested.ping.mutationOptions())

      return { mutation }
    },
    render: () => null,
  }))

  mounted.vm.mutation.mutate({ input: 123 })

  await vi.waitFor(() => expect(mounted.vm.mutation.data.value).toEqual({ output: '123' }))

  vi.mocked(router.nested.ping['~orpc'].handler).mockRejectedValueOnce(new ORPCError('OVERRIDE'))

  mounted.vm.mutation.mutate({ input: 456 })

  await vi.waitFor(() => {
    expect((mounted.vm.mutation as any).error.value).toBeInstanceOf(ORPCError)
    expect((mounted.vm.mutation as any).error.value).toSatisfy(isInferableError)
    expect((mounted.vm.mutation as any).error.value.code).toEqual('OVERRIDE')
  })
})

it('case: with interceptors and plugins', async () => {
  const queryInterceptor = vi.fn(({ next }: any) => next())
  const mutationInterceptor = vi.fn(({ next }: any) => next())

  const utils = createORPCVueColadaUtils(client, {
    queryInterceptors: [queryInterceptor],
    plugins: [
      {
        name: 'test-plugin',
        init: options => ({
          ...options,
          mutationInterceptors: [...(options.mutationInterceptors ?? []), mutationInterceptor],
        }),
      },
    ],
  })

  const mounted = mount(defineComponent({
    setup() {
      const query = useQuery(utils.nested.ping.queryOptions({ input: { input: 123 } }))
      const mutation = useMutation(utils.nested.ping.mutationOptions())

      return { query, mutation }
    },
    render: () => null,
  }))

  await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual({ output: '123' }))

  expect(queryInterceptor).toHaveBeenCalledTimes(1)
  expect(queryInterceptor).toHaveBeenCalledWith(expect.objectContaining({
    path: ['nested', 'ping'],
    input: { input: 123 },
    context: expect.objectContaining({
      [VUE_COLADA_OPERATION_CONTEXT_SYMBOL]: {
        key: utils.nested.ping.key({ type: 'query', input: { input: 123 } }),
        type: 'query',
      },
    }),
  }))

  mounted.vm.mutation.mutate({ input: 456 })

  await vi.waitFor(() => expect(mounted.vm.mutation.data.value).toEqual({ output: '456' }))

  expect(mutationInterceptor).toHaveBeenCalledTimes(1)
  expect(mutationInterceptor).toHaveBeenCalledWith(expect.objectContaining({
    path: ['nested', 'ping'],
    input: { input: 456 },
    context: expect.objectContaining({
      [VUE_COLADA_OPERATION_CONTEXT_SYMBOL]: {
        key: utils.nested.ping.key({ type: 'mutation', input: { input: 456 } }),
        type: 'mutation',
      },
    }),
  }))
})
