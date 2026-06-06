import { authed, pub } from '../../../orpc'
import { retry } from '../../../middlewares/retry'

export const marketTrendIndexesRouter = {
  list: pub
    .apps
    .marketTrends
    .indexes
    .list
    .use(retry({ times: 3 }))
    .handler(async ({ context }) => {
      return context.db.apps.marketTrends.indexes.list()
    }),

  refresh: authed
    .apps
    .marketTrends
    .indexes
    .refresh
    .handler(async ({ context }) => {
      return context.db.apps.marketTrends.indexes.refresh()
    })
}
