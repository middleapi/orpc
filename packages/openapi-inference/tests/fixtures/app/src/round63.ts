/* oxlint-disable typescript/no-wrapper-object-types, typescript/no-empty-object-type -- interfaces over a view of Function */
import { os, type } from '@orpc/server'

/** An interface over a readonly view of `Function` with an optional `toJSON` */
export interface ViewedMaybeJsonFn extends Readonly<Function> {
  toJSON?(): string
}

/** An interface over a readonly view of `Function` with its own `toJSON` */
export interface ViewedJsonFn extends Readonly<Function> {
  toJSON(): string
}

/** An interface over a readonly view of `Function` */
export interface ViewedFn extends Readonly<Function> {}

/** Holds views of them, functions the serializer drops without a `toJSON` */
export interface ViewedFnHolder {
  maybeJson: Readonly<ViewedMaybeJsonFn>
  maybeJsonPartial: Partial<ViewedMaybeJsonFn>
  maybeJsonDeep: Readonly<Readonly<ViewedMaybeJsonFn>>
  maybeJsonWritten: Readonly<ViewedMaybeJsonFn>
  json: Readonly<ViewedJsonFn>
  jsonDeep: Readonly<Readonly<ViewedJsonFn>>
  plain: Readonly<ViewedFn>
}

const withToJSON = () => Object.assign(() => 1, { toJSON: () => 'f' })
const viewedFn: ViewedMaybeJsonFn = () => 2

export const viewedFnHolder = (): ViewedFnHolder => ({
  maybeJson: () => 1,
  maybeJsonPartial: viewedFn,
  maybeJsonDeep: () => 3,
  maybeJsonWritten: withToJSON(),
  json: withToJSON(),
  jsonDeep: withToJSON(),
  plain: () => 4,
})

/** A class holding views of them in fields, which `JSON.stringify` writes */
export class ViewedFnClassHolder {
  maybeJson: Readonly<ViewedMaybeJsonFn> = () => 1
  maybeJsonDeep: Readonly<Readonly<ViewedMaybeJsonFn>> = () => 2
  json: Readonly<ViewedJsonFn> = withToJSON()
}

export const roundSixtyThree = {
  viewedFnHolder: os.handler(viewedFnHolder),
  viewedFnClassHolder: os.handler(() => new ViewedFnClassHolder()),
}

export const roundSixtyThreeInputs = {
  viewedFnHolder: os.input(type<ViewedFnHolder>()).handler(() => 1),
}
