import type { Client, NestedClient, ORPCError } from '@orpc/client'

export type JsonifiedValue<T>
    = T extends string ? T
      : T extends number ? T
        : T extends boolean ? T
          : T extends null ? T
            : T extends undefined ? T
              : T extends Array<unknown> ? JsonifiedArray<T>
                : T extends Record<string, unknown> ? { [K in keyof T]: JsonifiedValue<T[K]> }
                  : T extends Date ? string
                    : T extends bigint ? string
                      : T extends File ? File
                        : T extends Blob ? Blob
                          : T extends RegExp ? string
                            : T extends URL ? string
                              : T extends Map<infer K, infer V> ? JsonifiedArray<[K, V][]>
                                : T extends Set<infer U> ? JsonifiedArray<U[]>
                                  : T extends AsyncIteratorObject<infer U, infer V> ? AsyncIteratorObject<JsonifiedValue<U>, JsonifiedValue<V>>
                                    : unknown

export type JsonifiedArray<T extends Array<unknown>> = T extends readonly []
  ? []
  : T extends readonly [infer U, ...infer V]
    ? [U extends undefined ? null : JsonifiedValue<U>, ...JsonifiedArray<V>]
    : T extends Array<infer U>
      ? Array<JsonifiedValue<U>>
      : unknown

/**
 * Convert types that JSON not support to corresponding json types
 *
 * @see {@link https://orpc.unnoq.com/docs/openapi/client/openapi-link OpenAPI Link Docs}
 */
export type JsonifiedClient<T extends NestedClient<any>>
= T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
  ? Client<UClientContext, UInput, JsonifiedValue<UOutput>, UError extends ORPCError<infer UCode, infer UData> ? ORPCError<UCode, JsonifiedValue<UData>> : UError>
  : {
      [K in keyof T]: T[K] extends NestedClient<any> ? JsonifiedClient<T[K]> : T[K];
    }
