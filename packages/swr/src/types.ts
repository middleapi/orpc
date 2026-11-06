import type { ClientContext } from '@orpc/client'
import type { PartialDeep, StreamedArrayOptions } from '@orpc/shared'
import type { SWRSubscriptionOptions } from 'swr/subscription'

import type { OperationKey } from './key.ts'

export type InferSubscriberOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U[] : never
export type InferLiveSubscriberOutput<TOutput> = TOutput extends AsyncIterable<infer U> ? U : never

export type OperationType = 'fetcher' | 'mutator' | 'subscriber' | 'liveSubscriber'

/**
 * The symbol under which SWR utils attach operation details
 * (key and operation type) to the client context.
 *
 * @see {@link https://orpc.dev/docs/integrations/swr#operation-context | SWR Integration - Operation Context}
 */
export const OPERATION_CONTEXT_SYMBOL: unique symbol = /* @__PURE__ */ Symbol.for(
  'ORPC_SWR_OPERATION_CONTEXT',
)

/**
 * A client context automatically populated by SWR utils,
 * exposing the operation key and type of the calling operation.
 *
 * @see {@link https://orpc.dev/docs/integrations/swr#operation-context | SWR Integration - Operation Context}
 */
export interface OperationContext {
  [OPERATION_CONTEXT_SYMBOL]?: {
    key: unknown
    type: OperationType
  }
}

export type KeyOptions<TInput> = undefined extends TInput ? { input?: TInput } : { input: TInput }

export type MatcherStrategy = 'exact' | 'partial'

export type MatcherOptions<TStrategy extends MatcherStrategy, TInput> = ('partial' extends TStrategy
  ? { input?: PartialDeep<TInput> | undefined }
  : undefined extends TInput
    ? { input?: TInput }
    : { input: TInput }) & {
  strategy?: TStrategy | undefined
}

export type Matcher = (key?: unknown) => boolean

export type FetcherOptions<TClientContext extends ClientContext> = object extends TClientContext
  ? { context?: TClientContext | undefined }
  : { context: TClientContext }

export type SubscriberOptions<TClientContext extends ClientContext> =
  FetcherOptions<TClientContext> & StreamedArrayOptions

export type MutatorOptions<TClientContext extends ClientContext> = FetcherOptions<TClientContext>

export type Fetcher<TInput, TOutput> = (key: OperationKey<TInput>) => Promise<TOutput>

export type Mutator<TInput, TOutput> = (
  key: unknown,
  options: Readonly<{ arg: TInput }>,
) => Promise<TOutput>

export type Subscriber<TInput, TData, TError> = (
  key: OperationKey<TInput>,
  options: SWRSubscriptionOptions<TData, TError>,
) => () => void
