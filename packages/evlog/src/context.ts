import type { RequestLogger } from 'evlog'

export const LOGGER_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_EVLOG_LOGGER_CONTEXT')

export interface LoggerContext {
  [LOGGER_CONTEXT_SYMBOL]?: undefined | RequestLogger
}

export function getLogger(context: LoggerContext): RequestLogger | undefined {
  return context[LOGGER_CONTEXT_SYMBOL]
}
