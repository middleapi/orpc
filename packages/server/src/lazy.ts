import type { AnyMetaPlugin, Meta } from '@orpc/contract'
import { isNonPrimitive } from '@orpc/shared'

export interface LazyDefinition<T> {
  meta: Meta
  metaPlugins?: AnyMetaPlugin[] | undefined
  loader: () => Promise<{ default: T }>
}

export class Lazy<T> {
  '~orpc': LazyDefinition<T>

  'constructor'(def: LazyDefinition<T>) {
    this['~orpc'] = def
  }

  /**
   * Checks if the given instance satisfies the {@link Lazy} class/interface.
   */
  static [Symbol.hasInstance](instance: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, instance)) {
      return true
    }

    if (this !== Lazy) {
      return false
    }

    return (
      isNonPrimitive(instance) &&
      isNonPrimitive(instance['~orpc']) &&
      isNonPrimitive(instance['~orpc'].meta) &&
      (instance['~orpc'].metaPlugins === undefined ||
        Array.isArray(instance['~orpc'].metaPlugins)) &&
      typeof instance['~orpc'].loader === 'function'
    )
  }
}

export type Lazyable<T> = T | Lazy<T>

export function unlazy<T extends Lazyable<any>>(
  maybeLazy: T,
): Promise<{ default: T extends Lazy<infer U> ? U : T }> {
  return maybeLazy instanceof Lazy
    ? maybeLazy['~orpc'].loader()
    : Promise.resolve({ default: maybeLazy as T extends Lazy<infer U> ? U : T })
}
