import type { AnySchema, Schema } from '@orpc/contract'
import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Schema as EffectSchema, Function } from 'effect'

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
 * `Schema.flip` creates a new schema on every call, so memoize to keep one instance per schema
 * (e.g. for the JSON Schema converter `cache` option).
 */
const toFlippedStandardSchema = Function.memoize((schema: EffectSchema.Top): AnySchema =>
  // the `ConstraintEncoder` constraint below guarantees encoding needs no services
  EffectSchema.toStandardSchemaV1(EffectSchema.flip(schema as EffectSchema.Codec<unknown, unknown>)),
)

/**
 * Like {@link toStandardSchema}, but validates by encoding, as Effect's HttpApi and RPC do for outputs:
 * it accepts the `Type` and produces the `Encoded` form. Used by the `.output` extension.
 */
export function toOutputStandardSchema<S extends EffectSchema.ConstraintEncoder<any>>(
  schema: S,
): Schema<S['Type'], S['Encoded']> {
  const converted = toFlippedStandardSchema(schema as unknown as EffectSchema.Top)
  const metaPlugins = getHiddenMetaPlugins(schema)
  if (metaPlugins) {
    setHiddenMetaPlugins(converted, metaPlugins)
  }

  return converted
}
