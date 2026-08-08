import { getRouter } from '@orpc/server'

export function synthesizeControllerMethod(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
  key: string,
): { methodName: string, childDescriptor: PropertyDescriptor } {
  let methodName = `${propertyKey}_${key}`
  let i = 0
  while (methodName in target) {
    methodName = `${propertyKey}_${key}_${i++}`
  }

  target[methodName] = async function (...args: any[]) {
    const router = await descriptor.value!.apply(this, args)
    return getRouter(router, [key])
  }

  Object.setPrototypeOf(target[methodName], descriptor.value!)

  queueMicrotask(() => {
    for (const p of Reflect.getOwnMetadataKeys(target, propertyKey)) {
      Reflect.defineMetadata(p, Reflect.getOwnMetadata(p, target, propertyKey), target, methodName)
    }
    for (const p of Reflect.getOwnMetadataKeys(target.constructor, propertyKey)) {
      Reflect.defineMetadata(p, Reflect.getOwnMetadata(p, target.constructor, propertyKey), target.constructor, methodName)
    }
  })

  const childDescriptor = Object.getOwnPropertyDescriptor(target, methodName)!

  return { methodName, childDescriptor }
}
