import type { RequestLogger } from 'evlog'

export const EVLOG_LOGGER_CONTEXT_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for(
  'ORPC_EVLOG_LOGGER_CONTEXT',
)

/**
 * Context shape that carries the Evlog request logger injected by `EvlogHandlerPlugin`.
 *
 * @see {@link https://orpc.dev/docs/integrations/evlog#without-asynclocalstorage | Evlog Integration - Without AsyncLocalStorage}
 */
export interface EvlogLoggerContext {
  [EVLOG_LOGGER_CONTEXT_SYMBOL]?: RequestLogger | undefined
}

/**
 * Retrieves the Evlog request logger from the oRPC context, if available.
 *
 * @see {@link https://orpc.dev/docs/integrations/evlog#without-asynclocalstorage | Evlog Integration - Without AsyncLocalStorage}
 */
export function getEvlogLogger(context: EvlogLoggerContext): RequestLogger | undefined {
  return context[EVLOG_LOGGER_CONTEXT_SYMBOL]
}
