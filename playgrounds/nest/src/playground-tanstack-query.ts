import { orpc } from './lib/orpc'
import { isDefinedError } from '@orpc/client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const query = useInfiniteQuery(
  orpc.planet.list.infiniteOptions({
    input: cursor => ({ cursor }),
    getNextPageParam: lastPage => (lastPage.at(-1)?.id ?? -1) + 1,
    initialPageParam: 0,
  }),
)

const queryClient = useQueryClient()

const mutation = useMutation(
  orpc.planet.update.mutationOptions({
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
