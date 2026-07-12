import type { Logger } from 'pino'
import type { PinoHandlerPluginContext } from './handler-plugin'
import { PINO_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'

export function getLogger(context: PinoHandlerPluginContext): Logger | undefined {
  return context[PINO_HANDLER_PLUGIN_CONTEXT_SYMBOL]?.logger
}
