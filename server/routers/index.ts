import { orpc } from '../orpc'
import { lunariaRouter } from '../apps/lunaria/router'
import { marketTrendsRouter } from '../apps/market-trends/router'
import { platformRouter } from '../platform/router'

export const router = orpc.router({
  platform: platformRouter,
  apps: {
    lunaria: lunariaRouter,
    marketTrends: marketTrendsRouter,
  },
})
