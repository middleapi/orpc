import type { AnyProcedureContract, AnySchema, ErrorMap, MetaPlugin } from '@orpc/contract'
import type { Lazy } from '@orpc/server'
import type { Value } from '@orpc/shared'
import type { OpenRPCExternalDocumentationObject, OpenRPCMethodObject } from './types'

export interface OpenRPCMethodExample {
  name: string
  summary?: string | undefined
  description?: string | undefined

  /**
   * The procedure input, described as params the same way the method's params are.
   */
  input?: unknown

  /**
   * The procedure output. Omit it for an example without result.
   */
  output?: unknown
}

/**
 * Options of the OpenRPC Method Object generated for a procedure.
 * Fields left undefined fall back to the procedure's [OpenAPI meta](https://orpc.dev/docs/openapi/specification#metadata).
 */
export interface OpenRPCMeta {
  summary?: string | undefined
  description?: string | undefined
  deprecated?: boolean | undefined

  /**
   * **Merging**: When defined multiple times, tags are concatenated in definition order.
   * Explicitly setting `undefined` resets the tags instead of merging.
   */
  tags?: string[] | undefined

  externalDocs?: OpenRPCExternalDocumentationObject | undefined
  examples?: OpenRPCMethodExample[] | undefined

  /**
   * Replaces the generated Method Object when an object, or transforms it when a function.
   *
   * **Merging**: When defined multiple times, two functions are chained, a function combined with an object
   * is applied to that object, and between two objects the most recent one wins.
   * Explicitly setting `undefined` resets the spec instead of merging.
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
 * Controls how a procedure is described in the generated OpenRPC document.
 * When defined multiple times, fields are overridden by the most recent call, except `tags` and `spec`.
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

    const spec: OpenRPCMeta['spec']
      = typeof existingSpec === 'function' && typeof incomingSpec === 'function'
        ? current => incomingSpec(existingSpec(current))
        : typeof existingSpec === 'function' && typeof incomingSpec === 'object'
          ? existingSpec(incomingSpec)
          : typeof existingSpec === 'object' && typeof incomingSpec === 'function'
            ? incomingSpec(existingSpec)
            : 'spec' in incoming ? incomingSpec : existingSpec

    return { ...meta, '~openrpc': { ...existing, ...incoming, tags, spec } satisfies OpenRPCMeta }
  },
})

/**
 * Reads the OpenRPC meta attached to a procedure or contract by `openrpc`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#metadata | OpenRPC Specification - Metadata}
 */
export function getOpenRPCMeta(procedureOrLazy: AnyProcedureContract | Lazy<any>): OpenRPCMeta | undefined {
  return procedureOrLazy['~orpc'].meta['~openrpc'] as OpenRPCMeta | undefined
}
