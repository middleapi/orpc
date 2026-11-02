import type { ErrorMap } from './error'
import type { AnyMetaPlugin, Meta, MetaPlugin } from './meta'
import type { AnySchema } from './schema'
import { toArray } from '@orpc/shared'

export function resolveMetaPlugins<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
>(
  baseMeta: Meta,
  existingPlugins: MetaPlugin<TInputSchema, TOutputSchema, TErrorMap>[] | undefined,
  incomingPlugins: MetaPlugin<TInputSchema, TOutputSchema, TErrorMap>[] | undefined,
): [meta: Meta, plugins: MetaPlugin<TInputSchema, TOutputSchema, TErrorMap>[]] {
  existingPlugins = toArray(existingPlugins)
  incomingPlugins = toArray(incomingPlugins)

  let meta = baseMeta
  for (const plugin of incomingPlugins) {
    if (plugin.init) {
      meta = plugin.init(meta)
    }
  }

  const plugins = [...existingPlugins, ...incomingPlugins]

  for (const plugin of plugins) {
    if (plugin.apply) {
      meta = plugin.apply(meta)
    }
  }

  return [meta, plugins]
}

/**
 * Returns `plugins` without the plugins (matched by identity) that are also in `excluded`.
 * Each plugin in `excluded` removes at most one matching occurrence, so intentional duplicates are kept.
 *
 * Useful when combining plugins that were already resolved from a shared source,
 * e.g. a procedure built from the same builder that augments its router,
 * so the shared plugins are not initialized or applied twice.
 */
export function excludeMetaPlugins<T extends AnyMetaPlugin>(
  plugins: readonly T[] | undefined,
  excluded: readonly AnyMetaPlugin[] | undefined,
): T[] {
  const remaining = [...toArray(plugins)]

  for (const plugin of toArray(excluded)) {
    const index = remaining.indexOf(plugin as T)

    if (index !== -1) {
      remaining.splice(index, 1)
    }
  }

  return remaining
}

/**
 * Quickly defines a meta plugin factory and reader.
 *
 * @example Mark a procedure as requiring authentication and read it in middleware.
 * ```ts
 * interface AuthMeta {
 *   required?: boolean
 *   scope?: 'user' | 'admin'
 * }
 *
 * const [authMeta, getAuthMeta] = defineMeta(
 *   'auth',
 *   (incoming: AuthMeta, current) => ({ ...current, ...incoming }),
 * )
 *
 * const deletePostContract = oc
 *   .meta(authMeta({ required: true, scope: 'admin' }))
 *   .input(z.object({ postId: z.string() }))
 *   .output(z.object({ success: z.boolean() }))
 *
 * const authMiddleware = os.middleware(async ({ context, procedure, next }) => {
 *   const auth = getAuthMeta(procedure)
 *
 *   if (auth?.required && !context.user) {
 *     throw new ORPCError('UNAUTHORIZED')
 *   }
 *
 *   if (auth?.scope === 'admin' && !context.user?.isAdmin) {
 *     throw new ORPCError('FORBIDDEN')
 *   }
 *
 *   return next()
 * })
 * ```
 *
 * @param name - Unique key for storing this meta entry.
 * @param merge - Merges the existing value (or `undefined`) with the incoming value when applied multiple times.
 *
 * @returns A `[metaPlugin, getMeta]` tuple:
 *   - `metaPlugin(metadata)` - Attaches metadata to a procedure under `name`.
 *   - `getMeta(procedureOrLazy)` - Retrieves the metadata, or `undefined` if not set.
 *
 * @see {@link https://orpc.dev/docs/metadata | Metadata}
 */
export function defineMeta<TName extends string, TData>(
  name: TName,
  merge: (incoming: TData, current: TData | undefined) => TData,
): [
  metaPlugin: (meta: TData) => AnyMetaPlugin & { name: TName },
  getMeta: (procedureOrLazy: { '~orpc': { meta: Meta } }) => TData | undefined,
] {
  const metaPlugin = (value: TData): AnyMetaPlugin & { name: TName } => ({
    name,
    init: (meta) => {
      const current = meta[name] as TData | undefined

      return {
        ...meta,
        [name]: merge(value, current),
      }
    },
  })

  const getMeta = (procedureOrLazy: { '~orpc': { meta: Meta } }) => procedureOrLazy['~orpc'].meta[name] as TData | undefined

  return [metaPlugin, getMeta]
}
