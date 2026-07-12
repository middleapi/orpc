import type { RequestLogger } from 'evlog'
import type { EvlogHandlerPluginContext } from './handler-plugin'
import { EVLOG_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'

export function getLogger(context: EvlogHandlerPluginContext): RequestLogger | undefined {
  return (context as EvlogHandlerPluginContext)[EVLOG_HANDLER_PLUGIN_CONTEXT_SYMBOL]?.logger
}
