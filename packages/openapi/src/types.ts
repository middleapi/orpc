// eslint-disable-next-line no-restricted-imports
import type { OpenAPIV3_0, OpenAPIV3_1, OpenAPIV3_2 } from '@openapi-spec/types'
import type { AnyNestedClient, Client, ORPCError } from '@orpc/client'
import type { AsyncIteratorClass } from '@orpc/shared'

// eslint-disable-next-line no-restricted-imports
export type { OpenAPIV3_0, OpenAPIV3_1, OpenAPIV3_2 } from '@openapi-spec/types'

/**
 * An OpenAPI version `OpenAPIGenerator` can target: any `3.0.x`, `3.1.x`, or `3.2.x` value.
 *
 * @see {@link https://orpc.dev/docs/openapi/specification#openapi-version | OpenAPI Specification - OpenAPI Version}
 */
export type OpenAPIVersion = `3.0.${number}` | `3.1.${number}` | `3.2.${number}`

/**
 * The OpenAPI document of the given version.
 *
 * @see {@link https://orpc.dev/docs/openapi/specification#openapi-version | OpenAPI Specification - OpenAPI Version}
 */
export type OpenAPIDocument<TVersion extends OpenAPIVersion>
  = TVersion extends `3.0.${string}` ? OpenAPIV3_0.OpenAPIObject
    : TVersion extends `3.1.${string}` ? OpenAPIV3_1.OpenAPIObject
      : OpenAPIV3_2.OpenAPIObject

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
                        : T extends URL ? string
                          : T extends Map<infer K, infer V> ? JsonifiedArray<[K, V][]>
                            : T extends Set<infer U> ? JsonifiedArray<U[]>
                              : T extends AsyncIteratorClass<infer U, infer V> ? AsyncIteratorClass<JsonifiedValue<U>, JsonifiedValue<V>>
                                : T extends AsyncGenerator<infer U, infer V> ? AsyncGenerator<JsonifiedValue<U>, JsonifiedValue<V>>
                                  : T extends AsyncIteratorObject<infer U, infer V> ? AsyncIteratorObject<JsonifiedValue<U>, JsonifiedValue<V>>
                                    : unknown

export type JsonifiedArray<T extends Array<unknown>> = T extends readonly []
  ? []
  : T extends readonly [infer U, ...infer V]
    ? [U extends undefined ? null : JsonifiedValue<U>, ...JsonifiedArray<V>]
    : T extends Array<infer U>
      ? Array<JsonifiedValue<U>>
      : unknown

export type JsonifiedClientError<T>
  = T extends ORPCError<infer UCode, infer UData>
    ? ORPCError<UCode, JsonifiedValue<UData>>
    : T

/**
 * Client type whose outputs and error data replace types JSON cannot represent with their JSON equivalents.
 *
 * @see {@link https://orpc.dev/docs/openapi/link | OpenAPI Link}
 */
export type JsonifiedClient<T extends AnyNestedClient>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? Client<UClientContext, UInput, JsonifiedValue<UOutput>, JsonifiedClientError<UError>>
    : {
        [K in keyof T]: T[K] extends AnyNestedClient ? JsonifiedClient<T[K]> : T[K];
      }
