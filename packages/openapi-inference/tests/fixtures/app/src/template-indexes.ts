import { os, type } from '@orpc/server'

/** A leaf keyed by a template literal */
export interface KeyedLeaf {
  value: number
}

/** A value of an object literal type, which a template literal index does not check the keys of */
const settings = { mode: 'fast' }

/** Written by `JSON.stringify`, which writes a typed array by its index keys too */
export class ArrayLikeHolder {
  bytes: ArrayLike<number> = new Uint8Array([1])
  byId: Record<`id-${string}`, KeyedLeaf> = settings
}

export const templateIndexes = {
  typedArrayLike: os.handler((): ArrayLike<number> => new Uint8Array([1])),
  floatArrayLike: os.handler((): ArrayLike<number> => new Float32Array([0.5])),
  typedArrayLikes: os.handler(
    (): { w: ArrayLike<number>; list: ArrayLike<number>[]; sized: { length: number } } => ({
      w: new Uint8Array([1]),
      list: [new Int16Array([2]), [3]],
      sized: new Uint8Array([1, 2]),
    }),
  ),
  arrayLikeHolder: os.handler(() => new ArrayLikeHolder()),
  templateRecord: os.handler((): Record<`id-${string}`, KeyedLeaf> => settings),
  templateRecords: os.handler(
    (): { byId: Record<`id-${string}`, KeyedLeaf>; list: Record<`id-${string}`, KeyedLeaf>[] } => ({
      byId: { 'id-a': { value: 1 }, ...settings },
      list: [settings],
    }),
  ),
}

export const templateIndexesInputs = {
  arrayLike: os.input(type<ArrayLike<number>>()).handler(() => 1),
  templateRecord: os.input(type<Record<`id-${string}`, KeyedLeaf>>()).handler(() => 1),
}
