import type { MarketTrendIndex, MarketTrendRefreshResult } from '../../../../shared/apps/market-trends/schemas/market-trend'
import { listMarketTrendIndexes, refreshMarketTrends } from '../services/market-trends'

export interface MarketTrendIndexRepository {
  list: () => Promise<MarketTrendIndex[]>
  refresh: () => Promise<MarketTrendRefreshResult>
}

export function createMarketTrendIndexRepository(): MarketTrendIndexRepository {
  return {
    list: listMarketTrendIndexes,
    refresh: refreshMarketTrends
  }
}
