import type { ErrorMap } from './error'
import type { Meta, MetaPlugin } from './meta'
import type { AnySchema } from './schema'

export interface PathMetaPlugin<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends MetaPlugin<TInputSchema, TOutputSchema, TErrorMap> {
  name: '~path'
}

export const meta = {
  path<
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  >(
    path: string[],
  ): PathMetaPlugin<TInputSchema, TOutputSchema, TErrorMap> {
    return {
      name: '~path',
      init(meta) {
        return {
          ...meta,
          '~path': path,
        }
      },
    }
  },
}

export function getPathMeta(procedureOrLazy: { '~orpc': { meta: Meta } }): string[] | undefined {
  return procedureOrLazy['~orpc'].meta['~path'] as string[] | undefined
}
