// eslint-disable-next-line no-restricted-imports
import type { OpenAPIV3_1 } from '@hey-api/spec-types'
import type { AnyNestedClient, Client, ORPCError } from '@orpc/client'
import type { AsyncIteratorClass } from '@orpc/shared'

export type OpenAPIOperationObject = OpenAPIV3_1.OperationObject

/**
 * An OpenAPI 3.1 document with the OpenAPI 3.2 QUERY additions used by oRPC.
 * This type does not claim support for the complete OpenAPI 3.2 specification.
 */
export type OpenAPIDocument = Omit<OpenAPIV3_1.Document, 'openapi' | 'paths'> & {
  openapi: OpenAPIV3_1.Document['openapi'] | '3.2.0'
  paths?: undefined | OpenAPIV3_1.PathsObject & {
    [path: `/${string}`]: OpenAPIV3_1.PathItemObject & {
      query?: OpenAPIOperationObject | undefined
    }
  }
}

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
