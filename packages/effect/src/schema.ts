import type { Schema } from '@orpc/contract'
import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Schema as EffectSchema } from 'effect'

/**
 * Converts an Effect schema into a Standard Schema that decodes `Encoded` into `Type`.
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

/**
 * Converts an Effect schema into a Standard Schema that encodes `Type` into `Encoded`,
 * by decoding its flipped form.
 */
export function toStandardOutputSchema<S extends EffectSchema.Top & EffectSchema.ConstraintEncoder<any>>(
  schema: S,
): Schema<S['Type'], S['Encoded']> {
  const flipped = EffectSchema.flip(schema)

  // `flip` returns a new schema, so the meta plugins must be carried over explicitly
  const metaPlugins = getHiddenMetaPlugins(schema)
  if (metaPlugins) {
    setHiddenMetaPlugins(flipped, metaPlugins)
  }

  return toStandardSchema(flipped)
}
