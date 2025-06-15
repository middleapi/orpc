import type { Context } from '../../context'
import type { StandardHandleOptions } from './handler'

export type FriendlyStandardHandleOptions<T extends Context>
  = & Omit<StandardHandleOptions<T>, 'context'>
    & (Record<never, never> extends T ? { context?: T } : { context: T })

export function resolveFriendlyStandardHandleOptions<T extends Context>(options: FriendlyStandardHandleOptions<T>): StandardHandleOptions<T> {
  return {
    ...options,
    context: options.context ?? {} as T, // Context only optional if all fields are optional
  }
}
