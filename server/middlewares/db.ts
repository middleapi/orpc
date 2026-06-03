import { os } from '@orpc/server'
import type { PlanetRepository } from '../apps/lunaria/repositories/planets'
import type { MarketTrendIndexRepository } from '../apps/market-trends/repositories/indexes'
import { createPlanetRepository } from '../apps/lunaria/repositories/planets'
import { createMarketTrendIndexRepository } from '../apps/market-trends/repositories/indexes'

export interface DB {
  apps: {
    lunaria: {
      planets: PlanetRepository
    }
    marketTrends: {
      indexes: MarketTrendIndexRepository
    }
  }
}

export const dbProviderMiddleware = os
  .$context<{ db?: DB }>()
  .middleware(async ({ context, next }) => {
    const providedDb: DB = context.db ?? createDrizzleDB()

    return next({
      context: {
        db: providedDb,
      },
    })
  })

function createDrizzleDB(): DB {
  return {
    apps: {
      lunaria: {
        planets: createPlanetRepository(),
      },
      marketTrends: {
        indexes: createMarketTrendIndexRepository(),
      },
    },
  }
}
