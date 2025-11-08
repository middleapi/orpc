import type { Logger } from 'pino'
import { get } from '@orpc/shared'

export const CONTEXT_LOGGER_SYMBOL: unique symbol = Symbol('ORPC_PINO_CONTEXT_LOGGER_SYMBOL')

export interface LoggerContext {
  [CONTEXT_LOGGER_SYMBOL]?: Logger
}

export function getLogger(context: object): Logger | undefined {
  return get(context, [CONTEXT_LOGGER_SYMBOL]) as Logger | undefined
}
