import type { RequestResult } from '@hey-api/client-fetch'
import type { Client, ThrowableError } from '@orpc/client'

export type experimental_ToORPCClientResult<T extends Record<string, any>> = {
  [K in keyof T]:
  T[K] extends (options: infer UInput extends Record<any, any> | undefined)
  => RequestResult<infer USuccessResponse extends Record<number, any> | undefined, any, any>
    ? Client<Record<never, never>, UInput, {
      body: Exclude<USuccessResponse, undefined>[keyof Exclude<USuccessResponse, undefined>]
      request: Request
      response: Response
    }, ThrowableError>
    : never
}

/**
 * Convert a Hey API SDK to an oRPC client.
 *
 * @see {@link https://orpc.unnoq.com/docs/integrations/hey-api Hey API Docs}
 */
export function experimental_toORPCClient<T extends Record<string, any>>(sdk: T): experimental_ToORPCClientResult<T> {
  const client = {} as Record<string, Client<Record<never, never>, undefined | Record<any, any>, any, any>>

  for (const key in sdk) {
    const fn = sdk[key]

    if (!fn || typeof fn !== 'function') {
      continue
    }

    client[key] = async (input, options) => {
      const controller = new AbortController()

      if (input?.signal?.aborted || options?.signal?.aborted) {
        controller.abort()
      }
      else {
        input?.signal?.addEventListener('abort', () => controller.abort())
        options?.signal?.addEventListener('abort', () => controller.abort())
      }

      const result = await fn({
        ...input,
        signal: controller.signal,
        headers: {
          ...input?.headers,
          ...typeof options?.lastEventId === 'string' ? { 'last-event-id': options.lastEventId } : {},
        },
        throwOnError: true,
      })

      return {
        body: result.data,
        request: result.request,
        response: result.response,
      }
    }
  }

  return client as experimental_ToORPCClientResult<T>
}
