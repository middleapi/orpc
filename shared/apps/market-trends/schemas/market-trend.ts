import * as z from 'zod'

export type MarketTrendIndex = z.infer<typeof MarketTrendIndexSchema>
export type MarketTrendRefreshResult = z.infer<typeof MarketTrendRefreshResultSchema>

const IsoDateTimeSchema = z.iso.datetime()

const MarketTrendDirectionSchema = z.enum(['up', 'down', 'flat'])

export const MarketTrendRegionSchema = z.enum([
  'United States',
  'Japan',
  'South Korea',
  'Israel'
])

export const MarketTrendIndexSchema = z.object({
  id: z.number().int().min(1),
  displayOrder: z.number().int().min(1),
  symbol: z.string().min(1),
  providerSymbol: z.string().min(1),
  name: z.string().min(1),
  region: MarketTrendRegionSchema,
  currency: z.string().min(3).max(3),
  price: z.number(),
  change: z.number(),
  changePercent: z.number(),
  previousClose: z.number(),
  open: z.number().optional(),
  dayHigh: z.number().optional(),
  dayLow: z.number().optional(),
  volume: z.number().optional(),
  direction: MarketTrendDirectionSchema,
  marketTime: IsoDateTimeSchema,
  fetchedAt: IsoDateTimeSchema,
  source: z.string().min(1),
  sourceUrl: z.url(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
})

const MarketTrendRefreshFailureSchema = z.object({
  symbol: z.string().min(1),
  message: z.string().min(1)
})

export const MarketTrendRefreshResultSchema = z.object({
  fetchedAt: IsoDateTimeSchema,
  updated: z.array(MarketTrendIndexSchema),
  failed: z.array(MarketTrendRefreshFailureSchema)
})
