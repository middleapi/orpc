import type { Schema } from '@orpc/contract'
import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Schema as EffectSchema } from 'effect'

export function toStandardSchema<A, I>(
  schema: EffectSchema.Schema<A, I>,
): Schema<I, A> {
  const converted = EffectSchema.standardSchemaV1(schema)
  const metaPlugins = getHiddenMetaPlugins(schema)
  if (metaPlugins) {
    setHiddenMetaPlugins(converted, metaPlugins)
  }

  return converted
}
