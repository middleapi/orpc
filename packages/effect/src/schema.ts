import type { Schema } from '@orpc/contract'
import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Schema as EffectSchema } from 'effect'

function withHiddenMetaPluginsOf<T extends object>(source: object, target: T): T {
  const metaPlugins = getHiddenMetaPlugins(source)
  if (metaPlugins) {
    setHiddenMetaPlugins(target, metaPlugins)
  }

  return target
}

/**
 * Converts an Effect schema into a Standard Schema that decodes `Encoded` into `Type`.
 */
export function toStandardSchema<S extends EffectSchema.ConstraintDecoder<any>>(
  schema: S,
): Schema<S['Encoded'], S['Type']> & S {
  return withHiddenMetaPluginsOf(schema, EffectSchema.toStandardSchemaV1(schema))
}

/**
 * Converts an Effect schema into a Standard Schema that encodes `Type` into `Encoded`,
 * by decoding its flipped form.
 */
export function toStandardOutputSchema<S extends EffectSchema.Top & EffectSchema.ConstraintEncoder<any>>(
  schema: S,
): Schema<S['Type'], S['Encoded']> {
  return withHiddenMetaPluginsOf(schema, EffectSchema.toStandardSchemaV1(EffectSchema.flip(schema)))
}
