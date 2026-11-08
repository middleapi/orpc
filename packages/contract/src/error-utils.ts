import type { AnyORPCError } from '@orpc/client'
import { cloneORPCError } from '@orpc/client'
import type { Writable } from '@orpc/shared'
import { getOwn } from '@orpc/shared'

import type { ErrorMap } from './error.ts'

export type MergedErrorMap<T1 extends ErrorMap, T2 extends ErrorMap> = keyof T1 extends
  // oxlint-disable-next-line typescript/no-redundant-type-constituents
  never | keyof T2
  ? T2
  : Omit<T1, keyof T2> & T2

export function mergeErrorMap<T1 extends ErrorMap = object, T2 extends ErrorMap = object>(
  errorMap1: T1 | undefined,
  errorMap2: T2 | undefined,
): MergedErrorMap<T1, T2> {
  return { ...errorMap1, ...errorMap2 } as any
}

export async function reconcileORPCError(
  map: ErrorMap,
  error: AnyORPCError,
): Promise<AnyORPCError> {
  const config = getOwn(map, error.code)
  let defined = false
  let data = error.data

  if (config) {
    if (!config.data) {
      defined = true
    } else {
      const validated = await config.data['~standard'].validate(error.data)

      if (!validated.issues) {
        defined = true
        data = validated.value
      }
    }
  }

  if (error.defined === defined && error.data === data) {
    return error
  }

  const cloned = cloneORPCError(error)

  cloned.data = data
  ;(cloned.defined as Writable<typeof cloned.defined>) = defined

  return cloned
}
