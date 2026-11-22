export * from './context'
export * from './handler-plugin'

export {
  /**
   * @deprecated Use `EVLOG_LOGGER_CONTEXT_SYMBOL` instead.
   */
  EVLOG_LOGGER_CONTEXT_SYMBOL as LOGGER_CONTEXT_SYMBOL,
  /**
   * @deprecated Use `getEvlogLogger` instead.
   */
  getEvlogLogger as getLogger,
} from './context'
export type {
  /**
   * @deprecated Use `EvlogLoggerContext` instead.
   */
  EvlogLoggerContext as LoggerContext,
} from './context'
