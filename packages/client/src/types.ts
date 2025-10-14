import type { PromiseWithError } from '@orpc/shared'

export type HTTPPath = `/${string}`
export type HTTPMethod = 'HEAD' | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export type ClientContext = Record<PropertyKey, any>

export interface ClientOptions<T extends ClientContext> {
  signal?: AbortSignal
  lastEventId?: string | undefined
  context: T
}

export type FriendlyClientOptions<T extends ClientContext>
  = & Omit<ClientOptions<T>, 'context'>
    & (Record<never, never> extends T ? { context?: T } : { context: T })

export type ClientRest<TClientContext extends ClientContext, TInput> = Record<never, never> extends TClientContext
  ? undefined extends TInput
    ? [input?: TInput, options?: FriendlyClientOptions<TClientContext>]
    : [input: TInput, options?: FriendlyClientOptions<TClientContext>]
  : [input: TInput, options: FriendlyClientOptions<TClientContext>]

export type ClientPromiseResult<TOutput, TError> = PromiseWithError<TOutput, TError>

export interface Client<TClientContext extends ClientContext, TInput, TOutput, TError> {
  (...rest: ClientRest<TClientContext, TInput>): ClientPromiseResult<TOutput, TError>
}

export type NestedClient<TClientContext extends ClientContext> = Client<TClientContext, any, any, any> | {
  [k: string]: NestedClient<TClientContext>
}

export type InferClientContext<T extends NestedClient<any>> = T extends NestedClient<infer U> ? U : never

export interface ClientLink<TClientContext extends ClientContext> {
  call: (path: readonly string[], input: unknown, options: ClientOptions<TClientContext>) => Promise<unknown>
}

/**
 * Recursively infers the **input types** from a client.
 *
 * Produces a nested map where each endpoint's input type is preserved.
 */
export type InferClientInputs<T extends NestedClient<any>>
  = T extends Client<any, infer U, any, any>
    ? U
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? InferClientInputs<T[K]> : never
      }

/**
 * Recursively infers the **body input types** from a client.
 *
 * If an endpoint's input includes `{ body: ... }`, only the `body` portion is extracted.
 * Produces a nested map of body input types.
 */
export type InferClientBodyInputs<T extends NestedClient<any>>
  = T extends Client<any, infer U, any, any>
    ? U extends { body: infer UBody } ? UBody : U
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? InferClientBodyInputs<T[K]> : never
      }

/**
 * Recursively infers the **output types** from a client.
 *
 * Produces a nested map where each endpoint's output type is preserved.
 */
export type InferClientOutputs<T extends NestedClient<any>>
  = T extends Client<any, any, infer U, any>
    ? U
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? InferClientOutputs<T[K]> : never
      }

/**
 * Recursively infers the **body output types** from a client.
 *
 * If an endpoint's output includes `{ body: ... }`, only the `body` portion is extracted.
 * Produces a nested map of body output types.
 */
export type InferClientBodyOutputs<T extends NestedClient<any>>
  = T extends Client<any, any, infer U, any>
    ? U extends { body: infer UBody } ? UBody : U
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? InferClientBodyOutputs<T[K]> : never
      }

/**
 * Recursively infers the **error types** from a client when you use [type-safe errors](https://orpc.unnoq.com/docs/error-handling#type‐safe-error-handling).
 *
 * Produces a nested map where each endpoint's error type is preserved.
 */
export type InferClientErrors<T extends NestedClient<any>>
  = T extends Client<any, any, any, infer U>
    ? U
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? InferClientErrors<T[K]> : never
      }

/**
 * Recursively infers a **union of all error types** from a client when you use [type-safe errors](https://orpc.unnoq.com/docs/error-handling#type‐safe-error-handling).
 *
 * Useful when you want to handle all possible errors from any endpoint at once.
 */
export type InferClientErrorUnion<T extends NestedClient<any>>
  = T extends Client<any, any, any, infer U>
    ? U
    : {
        [K in keyof T]: T[K] extends NestedClient<any> ? InferClientErrorUnion<T[K]> : never
      }[keyof T]
