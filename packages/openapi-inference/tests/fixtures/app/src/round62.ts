import { os, type } from '@orpc/server'

/** An interface with an optional `toJSON`, written the same by the serializer and `JSON.stringify` */
export interface SharedMaybeJson {
  toJSON?(): string
  x: number
}

/** A class holding it in a field, which `JSON.stringify` writes */
export class SharedMaybeJsonHolder {
  shared: SharedMaybeJson = { x: 1 }
}

const inRoot = os.input(type<SharedMaybeJson>()).handler(() => 1)
const inObject = os.input(type<{ shared: SharedMaybeJson }>()).handler(() => 1)
const root = os.handler((): SharedMaybeJson => ({ x: 1 }))
const holder = os.handler(() => new SharedMaybeJsonHolder())

// the same procedures in every order, whose documents name the components the same
export const roundSixtyTwoInRootRootHolder = { inRoot, root, holder }
export const roundSixtyTwoInRootHolderRoot = { inRoot, holder, root }
export const roundSixtyTwoRootInRootHolder = { root, inRoot, holder }
export const roundSixtyTwoRootHolderInRoot = { root, holder, inRoot }
export const roundSixtyTwoHolderInRootRoot = { holder, inRoot, root }
export const roundSixtyTwoHolderRootInRoot = { holder, root, inRoot }

// an input and a class field using it, without an output root
export const roundSixtyTwoInObjectHolder = { inObject, holder }
export const roundSixtyTwoHolderInObject = { holder, inObject }
export const roundSixtyTwoInRootHolder = { inRoot, holder }
export const roundSixtyTwoHolderInRoot = { holder, inRoot }
