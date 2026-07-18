import { isInferableError } from '@orpc/client'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed } from 'vue'
import { client, orpc } from './__shared__/orpc'

it('.key', () => {
  const queryCache = useQueryCache()

  queryCache.invalidateQueries({
    key: orpc.nested.key(),
  })

  orpc.ping.key({})
  // @ts-expect-error --- input is invalid
  orpc.ping.key({ input: { input: 'INVALID' } })
})

it('.call', () => {
  expectTypeOf(orpc.ping.call).toEqualTypeOf(client.ping)
})

describe('.queryOptions', () => {
  it('useQuery', () => {
    const query = useQuery(orpc.ping.queryOptions({
      input: computed(() => ({ input: 123 })),
    }))

    if (isInferableError(query.error.value) && query.error.value.code === 'OVERRIDE') {
      expectTypeOf(query.error.value.data).toEqualTypeOf<unknown>()
    }

    expectTypeOf(query.data.value).toEqualTypeOf<{ output: string } | undefined>()

    useQuery(orpc.ping.queryOptions({
      input: {
        // @ts-expect-error --- input is invalid
        input: '123',
      },
    }))

    useQuery(orpc.ping.queryOptions({
      input: { input: 123 },
      context: {
        // @ts-expect-error --- cache is invalid
        cache: 123,
      },
    }))
  })
})

describe('.mutationOptions', () => {
  it('useMutation', async () => {
    const mutation = useMutation(orpc.ping.mutationOptions({
      onError(error, variables) {
        if (isInferableError(error) && error.code === 'BASE') {
          expectTypeOf(error.data).toEqualTypeOf<{ output: string }>()
        }
      },
    }))

    if (isInferableError(mutation.error.value) && mutation.error.value.code === 'OVERRIDE') {
      expectTypeOf(mutation.error.value.data).toEqualTypeOf<unknown>()
    }

    expectTypeOf(mutation.data.value).toEqualTypeOf<{ output: string } | undefined>()

    mutation.mutate({ input: 123 })

    mutation.mutateAsync({
      // @ts-expect-error --- input is invalid
      input: 'INVALID',
    })

    useMutation(orpc.ping.mutationOptions({
      context: {
        // @ts-expect-error --- cache is invalid
        cache: 123,
      },
    }))
  })
})
