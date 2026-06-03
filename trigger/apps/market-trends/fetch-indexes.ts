import { logger, schedules } from '@trigger.dev/sdk'
import { refreshMarketTrends } from '../../../server/apps/market-trends/services/market-trends'

export const fetchMarketTrendsTask = schedules.task({
  id: 'market-trends.fetch-indexes',
  cron: process.env.MARKET_TRENDS_CRON ?? '*/15 * * * *',
  run: async (payload) => {
    const result = await refreshMarketTrends()

    if (result.failed.length > 0) {
      logger.warn('Some market trend indexes failed to refresh', {
        failed: result.failed,
      })
    }

    logger.info('Market trend indexes refreshed', {
      scheduledAt: payload.timestamp,
      updated: result.updated.length,
      fetchedAt: result.fetchedAt,
    })

    if (result.updated.length === 0 && result.failed.length > 0) {
      throw new Error('All market trend index fetches failed')
    }

    return result
  },
})
