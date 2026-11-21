export * from './context'
export * from './handler-plugin'

export {
  /**
   * @deprecated Use `PINO_LOGGER_CONTEXT_SYMBOL` instead.
   */
  PINO_LOGGER_CONTEXT_SYMBOL as LOGGER_CONTEXT_SYMBOL,
  /**
   * @deprecated Use `getPinoLogger` instead.
   */
  getPinoLogger as getLogger,
} from './context'
export type {
  /**
   * @deprecated Use `PinoLoggerContext` instead.
   */
  PinoLoggerContext as LoggerContext,
} from './context'
