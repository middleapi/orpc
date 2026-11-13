// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os } from '@orpc/server'
import type { Simplify } from 'type-fest'

import type { DeepReadonlyIf } from './deep-views'
import type { MaybeExtra } from './view-intersections'
import { ValueBox } from './widened-views'

/** An object whose `toJSON` may be a string, which `JSON.stringify` does not call */
export interface StringOrToJSON {
  a: number
  toJSON: string | (() => { w: string })
}

/** An object whose `toJSON` may be a number */
export interface NumberOrToJSON {
  a: number
  toJSON: number | (() => { w: string })
}

export class FixedUser {
  id = 'u'
  tags = new Set(['a'])
  at = new Date(0)
}

const fixedUser = () => Object.assign(new FixedUser(), { id: 'fixed' as const })

export const nonFunctionToJson = {
  // a `toJSON` that may not be a function is not always called
  maybeToJSON: os.handler(
    (): {
      str: ValueBox<StringOrToJSON>
      strCalled: ValueBox<StringOrToJSON>
      num: ValueBox<NumberOrToJSON>
    } => ({
      str: new ValueBox<StringOrToJSON>({ a: 1, toJSON: 'x' }),
      strCalled: new ValueBox<StringOrToJSON>({ a: 1, toJSON: () => ({ w: 'x' }) }),
      num: new ValueBox<NumberOrToJSON>({ a: 1, toJSON: 2 }),
    }),
  ),
  // views of rest tuples intersected with an object are arrays of their elements
  restTupleViews: os.handler(
    (): {
      frozen: Readonly<[number, ...string[]] & MaybeExtra>
      partial: Partial<[number, ...string[]] & MaybeExtra>
    } => ({ frozen: [1, 'a'], partial: [1, 'a'] }),
  ),
  // a class with a member narrowed by an intersection, through views
  narrowedClass: os.handler(
    (): {
      deep: DeepReadonlyIf<FixedUser & { id: 'fixed' }>
      simple: Simplify<FixedUser & { id: 'fixed' }>
    } => ({ deep: fixedUser(), simple: fixedUser() }),
  ),
}
