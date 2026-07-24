import { oc } from '@orpc/contract'
import { tanstackQuery } from '@orpc/tanstack-query'
import z from 'zod'

export const contract2 = {
  planet: {
    find: oc.input(z.object({ id: z.number() })),
    update: oc
      .input(z.object({ id: z.number(), name: z.string() }))
      .meta(tanstackQuery({
        mutationInterceptors: [
          async ({ input, next, fnContext }) => {
            const utils = fnContext.meta?.utils

            if (!utils) {
              return next()
            }

            const queryKey = utils.contract.find.queryKey({ input: { id: input.id } })
            const previous = fnContext.client.getQueryData(queryKey)

            // optimistically update before the request
            fnContext.client.setQueryData(queryKey, input)

            try {
              return await next()
            }
            catch (error) {
              // roll back on error
              fnContext.client.setQueryData(queryKey, previous)
              throw error
            }
            finally {
              fnContext.client.invalidateQueries({ queryKey })
            }
          },
        ],
      })),
  },
}
