import type { AnyFunction } from '@orpc/shared'
import type { Ref } from 'vue'
import { isObject } from '@orpc/shared'
import { isRef } from 'vue'

export type UnrefDeep<T> = T extends Ref<infer U>
  ? UnrefDeep<U>
  : T extends AnyFunction ? T
    : T extends object ? { [K in keyof T]: UnrefDeep<T[K]> }
      : T

export function unrefDeep<T>(value: T): UnrefDeep<T> {
  if (isRef(value)) {
    return unrefDeep(value.value) as any
  }

  if (Array.isArray(value)) {
    return value.map(unrefDeep) as any
  }

  if (isObject(value)) {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = unrefDeep(value[key])
      return acc
    }, {} as Record<string, unknown>) as any
  }

  return value as any
}
