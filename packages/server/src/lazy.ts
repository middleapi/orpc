import type { AnyMetaPlugin, Meta } from '@orpc/contract'
import { getConstructor, isTypescriptObject } from '@orpc/shared'

export interface LazyDefinition<T> {
  meta: Meta
  metaPlugins?: AnyMetaPlugin[] | undefined
  loader: () => Promise<{ default: T }>
}

export class Lazy<T> {
  '~orpc': LazyDefinition<T>

  constructor(
    def: LazyDefinition<T>,
  ) {
    this['~orpc'] = def
  }

  /**
   * Checks if the given instance satisfies the {@link Lazy} class/interface.
   */
  static [Symbol.hasInstance](instance: unknown): boolean {
    if (this !== Lazy) {
      // fallback to default instanceof check if this is extended class
      return Function.prototype[Symbol.hasInstance].call(this, instance)
    }

    const constructor = getConstructor(instance)
    if (constructor === Lazy) {
      return true
    }

    return (
      isTypescriptObject(instance)
      && isTypescriptObject(instance['~orpc'])
      && isTypescriptObject(instance['~orpc'].meta)
      && (instance['~orpc'].metaPlugins === undefined || Array.isArray(instance['~orpc'].metaPlugins))
      && typeof instance['~orpc'].loader === 'function'
    )
  }
}

export type Lazyable<T> = T | Lazy<T>

const UNLAZY_CACHE: WeakMap<object, Promise<{ default: unknown }>> = /* @__PURE__ */ new WeakMap()

/**
 * Resolves a lazy value, or returns a non-lazy value as is.
 *
 * The result is memoized per {@link Lazy} instance, so its loader (and any work done on top of it,
 * like augmenting a router) runs once. A rejected load is not cached, so it can be retried.
 */
export function unlazy<T extends Lazyable<any>>(maybeLazy: T): Promise<{ default: T extends Lazy<infer U> ? U : T }> {
  if (!(maybeLazy instanceof Lazy)) {
    return Promise.resolve({ default: maybeLazy as T extends Lazy<infer U> ? U : T })
  }

  let promise = UNLAZY_CACHE.get(maybeLazy)

  if (promise === undefined) {
    const loading: Promise<{ default: unknown }> = Promise.resolve(maybeLazy['~orpc'].loader())
    promise = loading

    UNLAZY_CACHE.set(maybeLazy, loading)

    loading.catch(() => {
      if (UNLAZY_CACHE.get(maybeLazy) === loading) {
        UNLAZY_CACHE.delete(maybeLazy)
      }
    })
  }

  return promise as Promise<{ default: T extends Lazy<infer U> ? U : T }>
}
