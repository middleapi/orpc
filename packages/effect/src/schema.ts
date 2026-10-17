import type { Schema } from '@orpc/contract'
import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Schema as EffectSchema } from 'effect'

/**
 * Converts an Effect Schema into a Standard Schema that oRPC accepts for input and output validation.
 * Wraps Effect's `Schema.toStandardSchemaV1` and keeps any oRPC meta plugins attached to the original schema.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effect-schema | Effect Integration - Effect Schema}
 */
export function toStandardSchema<S extends EffectSchema.ConstraintDecoder<any>>(
  schema: S,
): Schema<S['Encoded'], S['Type']> & S {
  const converted = EffectSchema.toStandardSchemaV1(schema)
  const metaPlugins = getHiddenMetaPlugins(schema)
  if (metaPlugins) {
    setHiddenMetaPlugins(converted, metaPlugins)
  }

  return converted
}
