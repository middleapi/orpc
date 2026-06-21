import type { Logger } from 'pino'

export const LOGGER_CONTEXT_SYMBOL: unique symbol = Symbol.for('ORPC_PINO_LOGGER_CONTEXT')

export interface LoggerContext {
  [LOGGER_CONTEXT_SYMBOL]?: undefined | Logger
}

export function getLogger(context: LoggerContext): Logger | undefined {
  return context[LOGGER_CONTEXT_SYMBOL]
}
