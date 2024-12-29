import type { Arrayable, Promisable } from 'type-fest'
import { convertToStandardError } from './error'

export type OnStartState<TInput> = { status: 'pending', input: TInput, output: undefined, error: undefined }
export type OnSuccessState<TInput, TOutput> = { status: 'success', input: TInput, output: TOutput, error: undefined }
export type OnErrorState<TInput> = { status: 'error', input: TInput, output: undefined, error: Error }

export interface BaseHookMeta<TOutput> {
  next: () => Promise<TOutput>
}

export interface Hooks<TInput, TOutput, TContext, TMeta extends (Record<string, any> & { next?: never }) | undefined> {
  interceptor?: Arrayable<(input: TInput, context: TContext, meta: (TMeta extends undefined ? unknown : TMeta) & BaseHookMeta<TOutput>) => Promise<TOutput>>
  onStart?: Arrayable<(state: OnStartState<TInput>, context: TContext, meta: TMeta) => Promisable<void>>
  onSuccess?: Arrayable<(state: OnSuccessState<TInput, TOutput>, context: TContext, meta: TMeta) => Promisable<void>>
  onError?: Arrayable<(state: OnErrorState<TInput>, context: TContext, meta: TMeta) => Promisable<void>>
  onFinish?: Arrayable<(state: OnSuccessState<TInput, TOutput> | OnErrorState<TInput>, context: TContext, meta: TMeta) => Promisable<void>>
}

export async function executeWithHooks<TInput, TOutput, TContext, TMeta extends (Record<string, any> & { next?: never }) | undefined>(
  options: {
    hooks?: Hooks<TInput, TOutput, TContext, TMeta>
    input: TInput
    context: TContext
    meta: TMeta
    execute: BaseHookMeta<TOutput>['next']
  },
): Promise<TOutput> {
  const interceptors = convertToArray(options.hooks?.interceptor)
  const onStarts = convertToArray(options.hooks?.onStart)
  const onSuccesses = convertToArray(options.hooks?.onSuccess)
  const onErrors = convertToArray(options.hooks?.onError)
  const onFinishes = convertToArray(options.hooks?.onFinish)

  let currentExecuteIndex = 0

  const next = async (): Promise<TOutput> => {
    const execute = interceptors[currentExecuteIndex]

    if (execute) {
      currentExecuteIndex++
      return await execute(options.input, options.context, {
        ...options.meta,
        next,
      } as any)
    }

    let state: OnSuccessState<TInput, TOutput> | OnErrorState<TInput> | OnStartState<TInput>
      = { status: 'pending', input: options.input, output: undefined, error: undefined }

    try {
      for (const onStart of onStarts) {
        await onStart(state, options.context, options.meta)
      }

      const output = await options.execute()

      state = { status: 'success', input: options.input, output, error: undefined }

      for (let i = onSuccesses.length - 1; i >= 0; i--) {
        await onSuccesses[i]!(state, options.context, options.meta)
      }
    }
    catch (e) {
      state = { status: 'error', input: options.input, error: convertToStandardError(e), output: undefined }

      for (let i = onErrors.length - 1; i >= 0; i--) {
        try {
          await onErrors[i]!(state, options.context, options.meta)
        }
        catch (e) {
          state = { status: 'error', input: options.input, error: convertToStandardError(e), output: undefined }
        }
      }
    }

    for (let i = onFinishes.length - 1; i >= 0; i--) {
      try {
        await onFinishes[i]!(state, options.context, options.meta)
      }
      catch (e) {
        state = { status: 'error', input: options.input, error: convertToStandardError(e), output: undefined }
      }
    }

    if (state.status === 'error') {
      throw state.error
    }

    return state.output
  }

  return await next()
}

export function convertToArray<T>(value: undefined | T | readonly T[]): readonly T[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value] as any
}
