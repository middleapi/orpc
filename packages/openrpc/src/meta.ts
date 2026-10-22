import type { AnyProcedureContract, AnySchema, ErrorMap, MetaPlugin } from '@orpc/contract'
import type { Lazy } from '@orpc/server'
import type { Value } from '@orpc/shared'
import type { OpenRPCExternalDocumentationObject, OpenRPCMethodObject } from './types'

/**
 * An example call of a procedure, turned into an OpenRPC Example Pairing Object.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#examples | OpenRPC Specification - Examples}
 */
export interface OpenRPCMethodExample {
  /**
   * Name of the example pairing.
   */
  name: string

  /**
   * Short summary of the example.
   */
  summary?: string | undefined

  /**
   * Description of the example.
   */
  description?: string | undefined

  /**
   * Procedure input, mapped to example params with the method's param structure:
   * one param per property for by-name methods, a single `input` param for by-position methods.
   */
  input?: unknown

  /**
   * Procedure output, used as the example result.
   * When the key is absent the pairing has no result, which marks it as a notification example.
   */
  output?: unknown
}

/**
 * [OpenRPC Method](https://spec.open-rpc.org/#method-object) options attached to a procedure/contract,
 * used by `OpenRPCGenerator`.
 *
 * @remarks
 * Fields left undefined fall back to the procedure's [OpenAPI meta](https://orpc.dev/docs/openapi/specification#metadata),
 * so procedures already documented for OpenAPI need no extra meta.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#metadata | OpenRPC Specification - Metadata}
 */
export interface OpenRPCMeta {
  /**
   * Short summary of what the method does.
   *
   * @default OpenAPI `summary`
   */
  summary?: string | undefined

  /**
   * Verbose explanation of the method behavior.
   *
   * @default OpenAPI `description`
   */
  description?: string | undefined

  /**
   * Marks the method as deprecated.
   *
   * @default OpenAPI `deprecated`
   */
  deprecated?: boolean | undefined

  /**
   * Tag names used to group methods, emitted as Tag Objects.
   *
   * **Merging**: When defined multiple times, tags are concatenated in definition order.
   * Explicitly setting `undefined` resets the tags instead of merging.
   *
   * @default OpenAPI `tags`
   */
  tags?: string[] | undefined

  /**
   * Additional external documentation for the method.
   */
  externalDocs?: OpenRPCExternalDocumentationObject | undefined

  /**
   * Example calls of the method.
   *
   * **Merging**: When defined multiple times, the most recent examples replace the previous ones.
   *
   * @see {@link https://orpc.dev/docs/openrpc/specification#examples | OpenRPC Specification - Examples}
   */
  examples?: OpenRPCMethodExample[] | undefined

  /**
   * Override or extend the generated OpenRPC Method Object for this procedure.
   *
   * Pass a plain object to replace the entire method object, or a function that receives the current
   * method object and returns the modified version.
   *
   * **Merging**: When defined multiple times:
   *
   * - Two functions are chained: the most recent function receives the result of the previous one.
   * - A function combined with an object: the function is applied to that object.
   * - Two objects: the most recent object wins.
   *
   * Explicitly setting `undefined` resets the spec instead of merging.
   *
   * @remarks
   * **Note**: JSON-RPC calls are routed by the procedure path, so keep the method `name` unchanged.
   *
   * @see {@link https://orpc.dev/docs/openrpc/specification#customizing-the-method-object | OpenRPC Specification - Customizing the Method Object}
   */
  spec?: Value<OpenRPCMethodObject, [current: OpenRPCMethodObject]> | undefined
}

export interface OpenRPCMetaPlugin<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends MetaPlugin<TInputSchema, TOutputSchema, TErrorMap> {
  name: '~openrpc'
}

export interface OpenRPCFunction {
  (meta: OpenRPCMeta): OpenRPCMetaPlugin<any, any, any>
}

/**
 * Creates a meta plugin that controls how a procedure/contract is described in the generated OpenRPC document,
 * such as its summary, tags, examples, and Method Object spec.
 *
 * @example
 * ```ts
 * const findPlanet = os
 *   .meta(openrpc({
 *     summary: 'Find a planet',
 *     tags: ['planets'],
 *     examples: [{ name: 'earth', input: { id: 1 }, output: { id: 1, name: 'Earth' } }],
 *   }))
 *   .input(z.object({ id: z.number() }))
 *   .handler(async ({ input }) => ({ id: input.id, name: 'Earth' }))
 * ```
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#metadata | OpenRPC Specification - Metadata}
 */
export const openrpc: OpenRPCFunction = incoming => ({
  name: '~openrpc',
  init(meta) {
    const existing = meta['~openrpc'] as undefined | OpenRPCMeta

    const tags = existing?.tags && incoming.tags
      ? [...existing.tags, ...incoming.tags]
      : 'tags' in incoming ? incoming.tags : existing?.tags

    const existingSpec = existing?.spec
    const incomingSpec = incoming.spec

    // AVOID a function spec, it requires the current spec as an argument, triggering an extra auto-generation step.
    const spec: OpenRPCMeta['spec']
      = typeof existingSpec === 'function' && typeof incomingSpec === 'function'
        ? current => incomingSpec(existingSpec(current))
        : typeof existingSpec === 'function' && typeof incomingSpec === 'object'
          ? existingSpec(incomingSpec)
          : typeof existingSpec === 'object' && typeof incomingSpec === 'function'
            ? incomingSpec(existingSpec)
            : 'spec' in incoming ? incomingSpec : existingSpec

    const merged: OpenRPCMeta = {
      ...existing,
      ...incoming,
      tags,
      spec,
    }

    return {
      ...meta,
      '~openrpc': merged,
    }
  },
})

/**
 * Retrieves the OpenRPC metadata attached to a procedure, contract, or lazy router, or `undefined` if not set.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#metadata | OpenRPC Specification - Metadata}
 */
export function getOpenRPCMeta(procedureOrLazy: AnyProcedureContract | Lazy<any>): OpenRPCMeta | undefined {
  return procedureOrLazy['~orpc'].meta['~openrpc'] as OpenRPCMeta | undefined
}
