import { doublePrecision, integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const marketTrendsSchema = pgSchema('market_trends')

export const marketTrendIndexes = marketTrendsSchema.table('market_trend_indexes', {
  id: serial('id').primaryKey(),
  displayOrder: integer('display_order').notNull(),
  symbol: text('symbol').notNull().unique(),
  providerSymbol: text('provider_symbol').notNull(),
  name: text('name').notNull(),
  region: text('region').notNull(),
  currency: text('currency').notNull(),
  price: doublePrecision('price').notNull(),
  change: doublePrecision('change').notNull(),
  changePercent: doublePrecision('change_percent').notNull(),
  previousClose: doublePrecision('previous_close').notNull(),
  open: doublePrecision('open'),
  dayHigh: doublePrecision('day_high'),
  dayLow: doublePrecision('day_low'),
  volume: doublePrecision('volume'),
  marketTime: timestamp('market_time', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  sourceUrl: text('source_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
