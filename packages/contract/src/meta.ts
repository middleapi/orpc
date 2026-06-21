import type { ErrorMap } from './error'
import type { AnySchema } from './schema'
import { isTypescriptObject } from '@orpc/shared'

export interface Meta {
  [key: PropertyKey]: unknown
}

export interface MetaPluginDefinition<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  __TInputSchema?: { type: TInputSchema }
  __TOutputSchema?: { type: TOutputSchema }
  __TErrorMap?: { type: TErrorMap }
}

export interface MetaPlugin<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  /** This only for types, so it should be optional */
  '~orpc'?: MetaPluginDefinition<TInputSchema, TOutputSchema, TErrorMap> | undefined

  /** Unique name of the plugin, used for identification. */
  'name': string

  /**
   * Runs once when this plugin is first added to the builder.
   * Use this to set up initial metadata values.
   */
  'init'?: (meta: Meta) => Meta

  /**
   * Runs every time metadata is updated.
   * This is called for all plugins in the chain whenever a new plugin is added.
   */
  'apply'?: (meta: Meta) => Meta
}

export type AnyMetaPlugin = MetaPlugin<any, any, any>

export const HIDDEN_META_PLUGINS_SYMBOL = Symbol.for('ORPC_HIDDEN_META_PLUGINS')

export function getHiddenMetaPlugins(container: unknown): AnyMetaPlugin[] | undefined {
  if (!isTypescriptObject(container)) {
    return undefined
  }

  return container[HIDDEN_META_PLUGINS_SYMBOL] as AnyMetaPlugin[] | undefined
}

export function setHiddenMetaPlugins<T extends object>(container: T, metaPlugins: AnyMetaPlugin[]) {
  (container as any)[HIDDEN_META_PLUGINS_SYMBOL] = metaPlugins
}
