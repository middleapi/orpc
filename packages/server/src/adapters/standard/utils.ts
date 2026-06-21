import type { Context } from '../../context'
import type { StandardHandlerHandleOptions } from './handler'

export type FriendlyStandardHandlerHandleOptions<T extends Context>
  = & Omit<StandardHandlerHandleOptions<T>, 'context'>
    & (object extends T ? { context?: T } : { context: T })

export function resolveFriendlyStandardHandlerHandleOptions<T extends Context>(options: FriendlyStandardHandlerHandleOptions<T>): StandardHandlerHandleOptions<T> {
  return {
    ...options,
    context: options.context ?? {} as T, // Context only optional if all fields are optional
  }
}
