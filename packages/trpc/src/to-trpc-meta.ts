import type { AnyMetaPlugin, Meta } from '@orpc/contract'
import { resolveMetaPlugins } from '@orpc/contract'

/**
 * Resolve oRPC meta plugins into a plain meta object usable as tRPC meta.
 *
 * This simulates how oRPC builders apply meta plugins, so well-known plugins
 * like `openapi` from `@orpc/openapi` can be used with tRPC builders.
 *
 * @example
 * ```ts
 * const example = t.procedure
 *   .meta(toTRPCMeta(openapi({ path: '/hello' })))
 *   .query(() => 'Hello, World!')
 * ```
 *
 * @warning Unlike oRPC builders, chained tRPC `.meta()` calls merge shallowly,
 * so plugin merge logic (e.g. accumulating openapi `tags`) only applies to
 * plugins resolved within a single `toTRPCMeta` call.
 */
export function toTRPCMeta(...plugins: AnyMetaPlugin[]): Meta {
  const [meta] = resolveMetaPlugins({}, undefined, plugins)
  return meta
}
