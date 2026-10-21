import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, Context } from '@orpc/server'
import type { StandardHandlerCodec, StandardHandlerCodecResolvedProcedure } from '@orpc/server/standard'
import type { StandardLazyRequest } from '@standard-server/core'
import type { NestStandardLazyRequest } from './module'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getPathMeta } from '@orpc/contract'
import { getDynamicPathParams, getOpenAPIMeta } from '@orpc/openapi'
import { OpenAPIHandlerCodecCore } from '@orpc/openapi/standard'
import { mergeHttpPath, NullProtoObj } from '@orpc/shared'

export interface NestHandlerCodecMatch {
  /**
   * The procedure returned by the `@Implement` controller method.
   */
  procedure: AnyProcedure

  /**
   * Route parameters NestJS extracted from the request path.
   */
  params: NestStandardLazyRequest['params']
}

/**
 * NestJS has already routed the request by the time the handler runs,
 * so instead of matching the request url, this codec resolves the procedure
 * that the current {@link NestHandlerCodec.run} call stores in AsyncLocalStorage.
 * This lets a single standard handler (and its plugins) be reused across requests.
 */
export class NestHandlerCodec<T extends Context> extends OpenAPIHandlerCodecCore<T> implements StandardHandlerCodec<T> {
  private readonly storage = new AsyncLocalStorage<NestHandlerCodecMatch>()

  /**
   * Runs `fn` with `match` as the procedure resolved by {@link NestHandlerCodec.resolveProcedure}.
   */
  run<R>(match: NestHandlerCodecMatch, fn: () => R): R {
    return this.storage.run(match, fn)
  }

  resolveProcedure(request: StandardLazyRequest): StandardHandlerCodecResolvedProcedure | undefined {
    const match = this.storage.getStore()

    if (!match) {
      return undefined
    }

    const { procedure, params } = match

    return {
      path: getPathMeta(procedure) ?? [],
      procedure,
      decodeInput: () => this.decodeInput({
        procedure,
        params: toORPCOpenAPIParams(procedure, params),
      }, request),
    }
  }
}

function flattenParamValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join('/') : value
}

function toORPCOpenAPIParams(contract: AnyProcedureContract, params: NestStandardLazyRequest['params']): undefined | Record<string, string> {
  const meta = getOpenAPIMeta(contract)

  if (!params || meta?.path === undefined || Object.keys(params).length === 0) {
    return undefined
  }

  // NullProtoObj prevents prototype injection when a param is named like `__proto__`
  const orpcParams: Record<string, string> = new NullProtoObj()
  // express use `path` while fastify use `*` for rest matching
  const restKey = Object.hasOwn(params, '*') ? '*' : 'path'

  for (const [key, value] of Object.entries(params)) {
    if (key === restKey) {
      const restParams = getDynamicPathParams(
        meta.prefix ? mergeHttpPath(meta.prefix, meta.path) : meta.path,
      )?.filter(c => c.allowsSlash)

      if (restParams?.length) {
        for (const c of restParams) {
          orpcParams[c.parameterName] = flattenParamValue(value)
        }

        continue
      }
    }

    orpcParams[key] = flattenParamValue(value)
  }

  return orpcParams
}
