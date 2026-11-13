import { os, type } from '@orpc/server'

/** A tile, told apart by its kind */
export type Tile =
  | { kind: 'round'; radius: number; label?: string }
  | { kind: 'square'; size: number; label?: string }

/** A leaf of a tree */
export interface TileLeaf {
  value: number
}

/** An object type a `Set` and a `Map` satisfy by their `size` */
export type Sized = { size: number; label?: string }

/** A value of an object literal type, which a number index does not check the keys of */
const settings = { mode: 'fast' }

/** Written by `JSON.stringify`, which writes a `Set` or a `Map` as `{}` */
export class SizedHolder {
  sized: Sized = new Set(['a'])
  tile: Partial<Tile> = new Map([['a', 1]])
  byIndex: Record<number, TileLeaf> = settings
}

export const sizedTypes = {
  partialTileSet: os.handler((): Partial<Tile> => new Set([1])),
  partialTileMap: os.handler((): Partial<Tile> => new Map([['a', 1]])),
  partialTiles: os.handler(
    (): {
      set: Readonly<Partial<Tile>>
      map: NonNullable<Partial<Tile>>
      list: Partial<Tile>[]
    } => ({ set: new Set(['a']), map: new Map([['a', 1]]), list: [new Set([1]), { size: 1 }] }),
  ),
  sized: os.handler((): Sized => new Map([[1, 'a']])),
  sizedHolder: os.handler(() => new SizedHolder()),
  numberRecord: os.handler((): Record<number, TileLeaf> => settings),
  numberRecords: os.handler(
    (): {
      byIndex: Record<number, TileLeaf>
      named: { [index: number]: TileLeaf; mode?: string }
    } => ({ byIndex: { 0: { value: 1 }, ...settings }, named: settings }),
  ),
}

export const sizedTypesInputs = {
  partialTile: os.input(type<Partial<Tile>>()).handler(() => 1),
  sized: os.input(type<Sized>()).handler(() => 1),
  numberRecord: os.input(type<Record<number, TileLeaf>>()).handler(() => 1),
}
