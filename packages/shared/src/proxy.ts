import type { AnyFunction } from './function'

export function createCallableObject<TObject extends object, THandler extends AnyFunction>(obj: TObject, handler: THandler): TObject & THandler {
  const proxy = new Proxy(handler, {
    has(target, key) {
      return Reflect.has(obj, key) || Reflect.has(target, key)
    },
    ownKeys(target) {
      return Array.from(new Set(Reflect.ownKeys(obj).concat(...Reflect.ownKeys(target))))
    },
    get(target, key) {
      if (!Reflect.has(target, key) || Reflect.has(obj, key)) {
        return Reflect.get(obj, key)
      }

      return Reflect.get(target, key)
    },
    defineProperty(_, key, descriptor) {
      return Reflect.defineProperty(obj, key, descriptor)
    },
    set(_, key, value) {
      return Reflect.set(obj, key, value)
    },
    deleteProperty(target, key) {
      return Reflect.deleteProperty(target, key) && Reflect.deleteProperty(obj, key)
    },
  })

  return proxy as any
}
