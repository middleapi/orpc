import { oc } from '@orpc/contract'
import { MarketTrendIndexSchema, MarketTrendRefreshResultSchema } from '../schemas/market-trend'

export const marketTrendIndexesContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/apps/market-trends/indexes',
      summary: 'List market trend indexes',
      tags: ['Market trends']
    })
    .output(MarketTrendIndexSchema.array()),

  refresh: oc
    .route({
      method: 'POST',
      path: '/apps/market-trends/indexes/refresh',
      summary: 'Refresh market trend index data',
      tags: ['Market trends']
    })
    .output(MarketTrendRefreshResultSchema)
}
