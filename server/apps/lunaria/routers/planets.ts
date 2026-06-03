import { ORPCError } from '@orpc/server'
import { authed, pub } from '../../../orpc'
import { retry } from '../../../middlewares/retry'

export const lunariaPlanetsRouter = {
  list: pub
    .apps
    .lunaria
    .planets
    .list
    .use(retry({ times: 3 }))
    .handler(async ({ input, context }) => {
      return context.db.apps.lunaria.planets.list(input.limit, input.cursor)
    }),

  create: authed
    .apps
    .lunaria
    .planets
    .create
    .handler(async ({ input, context }) => {
      return context.db.apps.lunaria.planets.create(input, context.user)
    }),

  find: pub
    .apps
    .lunaria
    .planets
    .find
    .use(retry({ times: 3 }))
    .handler(async ({ input, context }) => {
      const planet = await context.db.apps.lunaria.planets.find(input.id)

      if (!planet) {
        throw new ORPCError('NOT_FOUND', { message: 'Planet not found' })
      }

      return planet
    }),

  update: authed
    .apps
    .lunaria
    .planets
    .update
    .handler(async ({ input, context, errors }) => {
      const planet = await context.db.apps.lunaria.planets.find(input.id)

      if (!planet) {
        throw errors.NOT_FOUND({ data: { id: input.id } })
      }

      return context.db.apps.lunaria.planets.update(input)
    }),
}
