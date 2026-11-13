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
export const permutationInRootRootHolder = { inRoot, root, holder }
export const permutationInRootHolderRoot = { inRoot, holder, root }
export const permutationRootInRootHolder = { root, inRoot, holder }
export const permutationRootHolderInRoot = { root, holder, inRoot }
export const permutationHolderInRootRoot = { holder, inRoot, root }
export const permutationHolderRootInRoot = { holder, root, inRoot }

// an input and a class field using it, without an output root
export const permutationInObjectHolder = { inObject, holder }
export const permutationHolderInObject = { holder, inObject }
export const permutationInRootHolder = { inRoot, holder }
export const permutationHolderInRoot = { holder, inRoot }
