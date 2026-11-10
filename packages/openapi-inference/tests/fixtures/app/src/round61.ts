/* oxlint-disable typescript/no-wrapper-object-types -- interfaces over a view of Function, and extending Number */
import { os } from '@orpc/server'

/** An interface with an optional `toJSON`, written the same by the serializer and `JSON.stringify` */
export interface MaybeJsonPoint {
  toJSON?(): string
  x: number
}

/** A class holding it in a field, which `JSON.stringify` writes */
export class MaybeJsonPointHolder {
  point: MaybeJsonPoint = { x: 1 }
  jsonPoint: MaybeJsonPoint = { x: 2, toJSON: () => 'p' }
}

/** An interface extending `Number` with an optional `toJSON` */
export interface MaybeJsonCount extends Number {
  toJSON?(): string
}

/** A class holding it in a field */
export class MaybeJsonCountHolder {
  count: MaybeJsonCount = 1
}

const maybeJsonPointRoot = os.handler((): MaybeJsonPoint => ({ x: 1 }))
const maybeJsonPointHolder = os.handler(() => new MaybeJsonPointHolder())
const maybeJsonCountRoot = os.handler((): MaybeJsonCount => 2)
const maybeJsonCountHolder = os.handler(() => new MaybeJsonCountHolder())

// the same procedures in other orders, whose documents name the components the same
export const roundSixtyOneForward = {
  a: maybeJsonPointRoot,
  b: maybeJsonPointHolder,
  c: maybeJsonCountRoot,
  d: maybeJsonCountHolder,
}
export const roundSixtyOneReverse = {
  d: maybeJsonCountHolder,
  c: maybeJsonCountRoot,
  b: maybeJsonPointHolder,
  a: maybeJsonPointRoot,
}
export const roundSixtyOneMixed = {
  b: maybeJsonPointHolder,
  c: maybeJsonCountRoot,
  a: maybeJsonPointRoot,
  d: maybeJsonCountHolder,
}
export const roundSixtyOneSwapped = {
  c: maybeJsonCountRoot,
  b: maybeJsonPointHolder,
  d: maybeJsonCountHolder,
  a: maybeJsonPointRoot,
}

/** An interface over a readonly view of `Function` with an optional `toJSON` */
export interface MaybeJsonFnView extends Readonly<Function> {
  toJSON?(): string
}

/** An interface over a readonly view of `Function` with its own `toJSON` */
export interface JsonFnView extends Readonly<Function> {
  toJSON(): string
}

/** An interface over a readonly view of `Function` */
export interface FnView extends Readonly<Function> {}

/** Holds values of them, functions the serializer drops without a `toJSON` */
export interface FnViewHolder {
  maybeJson: MaybeJsonFnView
  maybeJsonWritten: MaybeJsonFnView
  json: JsonFnView
  plain: FnView
}

const withToJSON = () => Object.assign(() => 1, { toJSON: () => 'f' })

export const fnViewHolder = (): FnViewHolder => ({
  maybeJson: () => 1,
  maybeJsonWritten: withToJSON(),
  json: withToJSON(),
  plain: () => 2,
})

export const roundSixtyOne = {
  maybeJsonPointRoot,
  maybeJsonPointHolder,
  maybeJsonCountRoot,
  maybeJsonCountHolder,
  fnViewHolder: os.handler(fnViewHolder),
}
