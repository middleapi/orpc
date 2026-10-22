import type { AnyNestedClient, Client } from '@orpc/client'
import type { JsonifiedClientError, JsonifiedValue } from '@orpc/openapi'

/**
 * The `result` a JSON-RPC response carries for an output of type `T`: JSON-ified, with `undefined`
 * sent as `null`, since the `result` member is required.
 */
export type JsonRpcResultValue<T>
  = 0 extends (1 & T) ? any
    : [T] extends [void | undefined] ? null
        : undefined extends T ? JsonifiedValue<Exclude<T, undefined>> | null
          : JsonifiedValue<T>

/**
 * Client type for `OpenRPCLink`: outputs and error data are JSON-ified, and an `undefined` output arrives as `null`.
 *
 * @see {@link https://orpc.dev/docs/openrpc/link#typesafe-clients | OpenRPC Link - Typesafe Clients}
 */
export type OpenRPCClient<T extends AnyNestedClient>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? Client<UClientContext, UInput, JsonRpcResultValue<UOutput>, JsonifiedClientError<UError>>
    : {
        [K in keyof T]: T[K] extends AnyNestedClient ? OpenRPCClient<T[K]> : T[K];
      }
