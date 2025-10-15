import { orpc } from './lib/orpc'
import { isDefinedError } from '@orpc/client'
import { createInfiniteQuery, createMutation, useQueryClient } from '@tanstack/svelte-query'

const query = createInfiniteQuery(
  () => orpc.planet.list.infiniteOptions({
    input: cursor => ({ cursor }),
    getNextPageParam: lastPage => (lastPage.at(-1)?.id ?? -1) + 1,
    initialPageParam: 0,
  }),
)

const queryClient = useQueryClient()

const mutation = createMutation(
  () => orpc.planet.update.mutationOptions({
    onError(error) {
      if (isDefinedError(error)) {
        const id = error.data.id
        //    ^    type-safe
      }
    },
    onSuccess() {
      queryClient.invalidateQueries({
        queryKey: orpc.planet.key(),
      })
    },
  }),
)
