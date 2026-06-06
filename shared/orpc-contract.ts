import { lunariaContract } from './apps/lunaria/contracts'
import { marketTrendsContract } from './apps/market-trends/contracts'
import { platformContract } from './platform/contracts'

export const orpcContract = {
  platform: platformContract,
  apps: {
    lunaria: lunariaContract,
    marketTrends: marketTrendsContract
  }
}
