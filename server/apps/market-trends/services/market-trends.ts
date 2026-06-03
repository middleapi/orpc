import type { MarketTrendIndex, MarketTrendRefreshResult } from '../../../../shared/apps/market-trends/schemas/market-trend'
import { asc, sql } from 'drizzle-orm'
import { db } from '../../../db/client'
import { marketTrendIndexes } from '../../../db/schema'
import { MarketTrendRegionSchema } from '../../../../shared/apps/market-trends/schemas/market-trend'

type MarketTrendProvider = 'yahoo-chart' | 'google-finance'

type MarketTrendDefinition = {
  displayOrder: number
  symbol: string
  providerSymbol: string
  name: string
  region: MarketTrendIndex['region']
  currency: string
  provider: MarketTrendProvider
  source: string
  sourceUrl: string
}

type MarketTrendQuote = Omit<MarketTrendIndex, 'id' | 'createdAt' | 'updatedAt' | 'direction'>

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>
    }>
    error?: {
      code?: string
      description?: string
    } | null
  }
}

const MARKET_TREND_DEFINITIONS: MarketTrendDefinition[] = [{
  displayOrder: 1,
  symbol: 'SPX',
  providerSymbol: '^GSPC',
  name: 'S&P 500',
  region: 'United States',
  currency: 'USD',
  provider: 'yahoo-chart',
  source: 'Yahoo Finance',
  sourceUrl: 'https://finance.yahoo.com/quote/%5EGSPC',
}, {
  displayOrder: 2,
  symbol: 'IXIC',
  providerSymbol: '^IXIC',
  name: 'NASDAQ Composite',
  region: 'United States',
  currency: 'USD',
  provider: 'yahoo-chart',
  source: 'Yahoo Finance',
  sourceUrl: 'https://finance.yahoo.com/quote/%5EIXIC',
}, {
  displayOrder: 3,
  symbol: 'N225',
  providerSymbol: '^N225',
  name: 'Nikkei 225',
  region: 'Japan',
  currency: 'JPY',
  provider: 'yahoo-chart',
  source: 'Yahoo Finance',
  sourceUrl: 'https://finance.yahoo.com/quote/%5EN225',
}, {
  displayOrder: 4,
  symbol: 'KS11',
  providerSymbol: '^KS11',
  name: 'KOSPI Composite',
  region: 'South Korea',
  currency: 'KRW',
  provider: 'yahoo-chart',
  source: 'Yahoo Finance',
  sourceUrl: 'https://finance.yahoo.com/quote/%5EKS11',
}, {
  displayOrder: 5,
  symbol: 'TA125',
  providerSymbol: '137:TLV',
  name: 'TA-125 Index',
  region: 'Israel',
  currency: 'ILS',
  provider: 'google-finance',
  source: 'Google Finance',
  sourceUrl: 'https://www.google.com/finance/quote/137:TLV?hl=en',
}]

const fetchHeaders = {
  accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  'user-agent': 'Mozilla/5.0 (compatible; LunariaMarketTrends/1.0)',
}

export async function listMarketTrendIndexes(): Promise<MarketTrendIndex[]> {
  const rows = await db
    .select()
    .from(marketTrendIndexes)
    .orderBy(asc(marketTrendIndexes.displayOrder), asc(marketTrendIndexes.name))

  return rows.map(toMarketTrendIndex)
}

export async function refreshMarketTrends(): Promise<MarketTrendRefreshResult> {
  const fetchedAt = new Date().toISOString()
  const results = await Promise.allSettled(
    MARKET_TREND_DEFINITIONS.map(definition => fetchMarketTrendQuote(definition, fetchedAt)),
  )

  const quotes: MarketTrendQuote[] = []
  const failed: MarketTrendRefreshResult['failed'] = []

  for (const [index, result] of results.entries()) {
    const definition = MARKET_TREND_DEFINITIONS[index]!

    if (result.status === 'fulfilled') {
      quotes.push(result.value)
    }
    else {
      failed.push({
        symbol: definition.symbol,
        message: getErrorMessage(result.reason),
      })
    }
  }

  const updated = await upsertMarketTrendQuotes(quotes)

  return {
    fetchedAt,
    updated,
    failed,
  }
}

async function upsertMarketTrendQuotes(quotes: MarketTrendQuote[]): Promise<MarketTrendIndex[]> {
  if (quotes.length === 0) {
    return []
  }

  const now = new Date()
  const rows = await db
    .insert(marketTrendIndexes)
    .values(quotes.map(quote => ({
      displayOrder: quote.displayOrder,
      symbol: quote.symbol,
      providerSymbol: quote.providerSymbol,
      name: quote.name,
      region: quote.region,
      currency: quote.currency,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      previousClose: quote.previousClose,
      open: quote.open ?? null,
      dayHigh: quote.dayHigh ?? null,
      dayLow: quote.dayLow ?? null,
      volume: quote.volume ?? null,
      marketTime: new Date(quote.marketTime),
      fetchedAt: new Date(quote.fetchedAt),
      source: quote.source,
      sourceUrl: quote.sourceUrl,
      updatedAt: now,
    })))
    .onConflictDoUpdate({
      target: marketTrendIndexes.symbol,
      set: {
        displayOrder: sql`excluded.display_order`,
        providerSymbol: sql`excluded.provider_symbol`,
        name: sql`excluded.name`,
        region: sql`excluded.region`,
        currency: sql`excluded.currency`,
        price: sql`excluded.price`,
        change: sql`excluded.change`,
        changePercent: sql`excluded.change_percent`,
        previousClose: sql`excluded.previous_close`,
        open: sql`excluded.open`,
        dayHigh: sql`excluded.day_high`,
        dayLow: sql`excluded.day_low`,
        volume: sql`excluded.volume`,
        marketTime: sql`excluded.market_time`,
        fetchedAt: sql`excluded.fetched_at`,
        source: sql`excluded.source`,
        sourceUrl: sql`excluded.source_url`,
        updatedAt: now,
      },
    })
    .returning()

  return rows
    .map(toMarketTrendIndex)
    .sort((left, right) => left.displayOrder - right.displayOrder)
}

async function fetchMarketTrendQuote(
  definition: MarketTrendDefinition,
  fetchedAt: string,
): Promise<MarketTrendQuote> {
  if (definition.provider === 'yahoo-chart') {
    return fetchYahooChartQuote(definition, fetchedAt)
  }

  return fetchGoogleFinanceQuote(definition, fetchedAt)
}

async function fetchYahooChartQuote(
  definition: MarketTrendDefinition,
  fetchedAt: string,
): Promise<MarketTrendQuote> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(definition.providerSymbol)}`)
  url.searchParams.set('range', '1d')
  url.searchParams.set('interval', '1m')

  const response = await fetch(url, { headers: fetchHeaders })
  const responseText = await response.text()

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status}: ${responseText.slice(0, 160)}`)
  }

  const data = JSON.parse(responseText) as YahooChartResponse
  const chartError = data.chart?.error

  if (chartError) {
    throw new Error(chartError.description ?? chartError.code ?? 'Yahoo Finance chart error')
  }

  const meta = data.chart?.result?.[0]?.meta

  if (!meta) {
    throw new Error('Yahoo Finance response did not include chart metadata')
  }

  const price = getRequiredNumber(meta.regularMarketPrice, 'regularMarketPrice')
  const previousClose = getOptionalNumber(meta.previousClose)
    ?? getOptionalNumber(meta.chartPreviousClose)

  if (previousClose === undefined) {
    throw new Error('Yahoo Finance response did not include previous close')
  }

  const change = roundMarketNumber(price - previousClose)
  const changePercent = previousClose === 0 ? 0 : roundMarketNumber((change / previousClose) * 100)
  const marketTime = getMarketTime(meta.regularMarketTime, fetchedAt)

  return {
    ...definition,
    price,
    change,
    changePercent,
    previousClose,
    open: getOptionalNumber(meta.regularMarketOpen),
    dayHigh: getOptionalNumber(meta.regularMarketDayHigh),
    dayLow: getOptionalNumber(meta.regularMarketDayLow),
    volume: getOptionalNumber(meta.regularMarketVolume),
    marketTime,
    fetchedAt,
  }
}

async function fetchGoogleFinanceQuote(
  definition: MarketTrendDefinition,
  fetchedAt: string,
): Promise<MarketTrendQuote> {
  const response = await fetch(definition.sourceUrl, { headers: fetchHeaders })
  const html = await response.text()

  if (!response.ok) {
    throw new Error(`Google Finance returned ${response.status}: ${html.slice(0, 160)}`)
  }

  const [symbol, exchange] = definition.providerSymbol.split(':')

  if (!symbol || !exchange) {
    throw new Error(`Invalid Google Finance symbol: ${definition.providerSymbol}`)
  }

  const quotePattern = new RegExp(
    String.raw`\["[^"]+",\["${escapeRegExp(symbol)}","${escapeRegExp(exchange)}"\],"[^"]+",\d+,null,\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),[^\]]*\],null,(-?\d+(?:\.\d+)?).*?\[(\d+)\],"[^"]+",-?\d+`,
    's',
  )
  const match = html.match(quotePattern)

  if (!match) {
    throw new Error(`Google Finance response did not include quote data for ${definition.providerSymbol}`)
  }

  const price = getRequiredNumber(Number(match[1]), 'price')
  const change = roundMarketNumber(getRequiredNumber(Number(match[2]), 'change'))
  const changePercent = roundMarketNumber(getRequiredNumber(Number(match[3]), 'changePercent'))
  const previousClose = getRequiredNumber(Number(match[4]), 'previousClose')
  const marketTimestamp = getRequiredNumber(Number(match[5]), 'marketTime')

  return {
    ...definition,
    price,
    change,
    changePercent,
    previousClose,
    marketTime: new Date(marketTimestamp * 1000).toISOString(),
    fetchedAt,
  }
}

function toMarketTrendIndex(row: typeof marketTrendIndexes.$inferSelect): MarketTrendIndex {
  return {
    id: row.id,
    displayOrder: row.displayOrder,
    symbol: row.symbol,
    providerSymbol: row.providerSymbol,
    name: row.name,
    region: MarketTrendRegionSchema.parse(row.region),
    currency: row.currency,
    price: row.price,
    change: row.change,
    changePercent: row.changePercent,
    previousClose: row.previousClose,
    open: numberOrUndefined(row.open),
    dayHigh: numberOrUndefined(row.dayHigh),
    dayLow: numberOrUndefined(row.dayLow),
    volume: numberOrUndefined(row.volume),
    direction: getDirection(row.change),
    marketTime: row.marketTime.toISOString(),
    fetchedAt: row.fetchedAt.toISOString(),
    source: row.source,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function getRequiredNumber(value: unknown, label: string): number {
  const numberValue = getOptionalNumber(value)

  if (numberValue === undefined) {
    throw new Error(`Missing numeric value: ${label}`)
  }

  return numberValue
}

function getOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function getMarketTime(value: unknown, fallback: string): string {
  const timestamp = getOptionalNumber(value)

  if (!timestamp) {
    return fallback
  }

  return new Date(timestamp * 1000).toISOString()
}

function getDirection(change: number): MarketTrendIndex['direction'] {
  if (Math.abs(change) < 0.0001) {
    return 'flat'
  }

  return change > 0 ? 'up' : 'down'
}

function numberOrUndefined(value: number | null): number | undefined {
  return value === null ? undefined : value
}

function roundMarketNumber(value: number): number {
  return Math.round(value * 10000) / 10000
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
