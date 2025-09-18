import type { ClientContext } from '@orpc/client'
import type { PartialDeep } from '@orpc/shared'
import type { SWRSubscriptionOptions } from 'swr/subscription'

export const SWR_OPERATION_CONTEXT_SYMBOL: unique symbol = Symbol('ORPC_SWR_OPERATION_CONTEXT')

export interface SWROperationContext {
  [SWR_OPERATION_CONTEXT_SYMBOL]: {
    type: 'fetcher' | 'mutator' | 'subscriber' | 'liveSubscriber'
  }
}

export type CreateKeyOptions<TInput>
  = undefined extends TInput ? { input?: TInput } : { input: TInput }

export function resolveCreateKeyOptions<TInput>(
  options: CreateKeyOptions<TInput>,
): CreateKeyOptions<TInput> & { input: TInput } {
  return {
    ...options,
    /**
     * Input is optional when it can be undefined,
     * so we can safely cast it to TInput with an undefined fallback.
     */
    input: options.input ?? undefined as TInput,
  }
}

export type KeyMeta<TInput> = {
  input: TInput
}

export type Key<TInput> = [path: readonly string[], options: KeyMeta<TInput>]

export type MatcherStrategy = 'exact' | 'partial'

export type CreateMatcherOptions<TStrategy extends MatcherStrategy, TInput>
  = (
    'partial' extends TStrategy
      ? { input?: PartialDeep<TInput> }
      : undefined extends TInput
        ? { input?: TInput }
        : { input: TInput }
  ) & {
    strategy?: TStrategy
  }

export type Matcher = (key?: unknown) => boolean

export type CreateFetcherOptions<TClientContext extends ClientContext>
  = (Record<never, never> extends TClientContext ? { context?: TClientContext } : { context: TClientContext })

export function resolveCreateFetcherOptions<T extends CreateFetcherOptions<any>>(
  options: T,
): T & { context: Exclude<T['context'], undefined> } {
  return {
    ...options,
    /**
     * Context is optional when all fields in TClientContext are optional,
     * so we can safely cast it to TClientContext with an empty object fallback.
     */
    context: options.context ?? ({} as Exclude<T['context'], undefined>),
  }
}

export type Fetcher<TInput, TOutput> = (key: Key<TInput>) => Promise<TOutput>

export type Mutator<TInput, TOutput> = (key: unknown, options: Readonly<{ arg: TInput }>) => Promise<TOutput>

export type CreateSubscriberOptions<TClientContext extends ClientContext> = CreateFetcherOptions<TClientContext> & {
  /**
   * Determines how data is handled when the subscription refetches.
   * - `reset`: Replace existing data with new data
   * - `append`: Add new data to existing data
   *
   * @default 'reset'
   */
  refetchMode?: 'reset' | 'append'

  /**
   * Maximum number of chunks to store.
   * When exceeded, the oldest chunks will be removed.
   */
  maxChunks?: number
}

export type Subscriber<TInput, TOutput, TError> = (
  key: Key<TInput>,
  options: SWRSubscriptionOptions<TOutput, TError>,
) => (() => void)
