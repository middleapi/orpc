import type { PromiseWithError } from '@orpc/shared'

export interface ClientContext {
  [key: PropertyKey]: any
}

export interface ClientOptions<T extends ClientContext> {
  signal?: AbortSignal | undefined
  lastEventId?: string | undefined
  context: T
}

export type FriendlyClientOptions<T extends ClientContext> = Omit<ClientOptions<T>, 'context'> &
  (object extends T ? { context?: T | undefined } : { context: T })

export type ClientRest<TClientContext extends ClientContext, TInput> = object extends TClientContext
  ? undefined extends TInput
    ? [input?: TInput, options?: FriendlyClientOptions<TClientContext>]
    : [input: TInput, options?: FriendlyClientOptions<TClientContext>]
  : [input: TInput, options: FriendlyClientOptions<TClientContext>]

export interface Client<TClientContext extends ClientContext, TInput, TOutput, TError> {
  (...rest: ClientRest<TClientContext, TInput>): PromiseWithError<TOutput, TError>
}

/**
 * `Client<any, any, any, any>` alone rejects a client whose input is `never`,
 * since `any` is not assignable to `never`.
 */
type ClientLeaf<TClientContext extends ClientContext> =
  | Client<TClientContext, any, any, any>
  | Client<TClientContext, never, any, any>

export type NestedClient<TClientContext extends ClientContext> =
  | ClientLeaf<TClientContext>
  | {
      [k: string]: NestedClient<TClientContext>
    }

export type AnyNestedClient = NestedClient<any>

/**
 * Infers the **client context type** required by a client.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-context | Client-Side Clients - Infer Client Context}
 */
export type InferClientContext<T extends AnyNestedClient> =
  T extends NestedClient<infer U> ? U : 0 extends 1 & T ? never : InferClientContextInternal<T>

export type InferClientContextInternal<T> =
  T extends Client<infer UContext, any, any, any>
    ? UContext
    : { [K in keyof T]-?: InferClientContextInternal<T[K]> }[keyof T]

type InferBody<T> = T extends unknown
  ? string extends keyof T
    ? T
    : 'body' extends keyof T
      ? T['body' & keyof T]
      : T
  : never

export interface ClientLink<TClientContext extends ClientContext> {
  call: (path: string[], input: unknown, options: ClientOptions<TClientContext>) => Promise<unknown>
}

/**
 * Recursively infers the **input types** from a client.
 *
 * Produces a nested map where each endpoint's input type is preserved.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-inputs | Client-Side Clients - Infer Client Inputs}
 */
export type InferClientInputs<T extends AnyNestedClient> = InferClientInputsInternal<T>

export type InferClientInputsInternal<T> =
  T extends Client<any, infer U, any, any>
    ? U
    : {
        [K in keyof T]: InferClientInputsInternal<T[K] & {}>
      }

/**
 * Recursively infers the **body input types** from a client.
 *
 * If an endpoint's input includes `{ body: ... }`, only the `body` portion is extracted.
 * Produces a nested map of body input types.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-body-inputs | Client-Side Clients - Infer Client Body Inputs}
 */
export type InferClientBodyInputs<T extends AnyNestedClient> = InferClientBodyInputsInternal<T>

export type InferClientBodyInputsInternal<T> =
  T extends Client<any, infer U, any, any>
    ? InferBody<U>
    : {
        [K in keyof T]: InferClientBodyInputsInternal<T[K] & {}>
      }

/**
 * Recursively infers the **output types** from a client.
 *
 * Produces a nested map where each endpoint's output type is preserved.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-outputs | Client-Side Clients - Infer Client Outputs}
 */
export type InferClientOutputs<T extends AnyNestedClient> = InferClientOutputsInternal<T>

export type InferClientOutputsInternal<T> =
  T extends Client<any, infer _UInput, infer U, any>
    ? U
    : {
        [K in keyof T]: InferClientOutputsInternal<T[K] & {}>
      }

/**
 * Recursively infers the **body output types** from a client.
 *
 * If an endpoint's output includes `{ body: ... }`, only the `body` portion is extracted.
 * Produces a nested map of body output types.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-body-outputs | Client-Side Clients - Infer Client Body Outputs}
 */
export type InferClientBodyOutputs<T extends AnyNestedClient> = InferClientBodyOutputsInternal<T>

export type InferClientBodyOutputsInternal<T> =
  T extends Client<any, infer _UInput, infer U, any>
    ? InferBody<U>
    : {
        [K in keyof T]: InferClientBodyOutputsInternal<T[K] & {}>
      }

/**
 * Recursively infers the **error types** from a client when you use [type-safe errors](https://orpc.dev/docs/error-handling#typesafe-errors).
 *
 * Produces a nested map where each endpoint's error type is preserved.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-errors | Client-Side Clients - Infer Client Errors}
 */
export type InferClientErrors<T extends AnyNestedClient> = InferClientErrorsInternal<T>

export type InferClientErrorsInternal<T> =
  T extends Client<any, infer _UInput, any, infer U>
    ? U
    : {
        [K in keyof T]: InferClientErrorsInternal<T[K] & {}>
      }

/**
 * Recursively infers a **union of all error types** from a client when you use [type-safe errors](https://orpc.dev/docs/error-handling#typesafe-errors).
 *
 * Useful when you want to handle all possible errors from any endpoint at once.
 *
 * @see {@link https://orpc.dev/docs/client/client-side#infer-client-error | Client-Side Clients - Infer Client Error}
 */
export type InferClientError<T extends AnyNestedClient> = InferClientErrorInternal<T>

export type InferClientErrorInternal<T> =
  T extends Client<any, infer _UInput, any, infer U>
    ? U
    : {
        [K in keyof T]-?: InferClientErrorInternal<T[K] & {}>
      }[keyof T]
