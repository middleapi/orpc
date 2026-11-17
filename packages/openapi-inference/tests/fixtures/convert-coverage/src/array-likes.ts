/** An object type of indexes from 0, with a number index for the items after them */
export interface IndexedPair {
  0: string
  1: number
  [index: number]: string | number
}

/** A tuple with an unresolved generic spread */
export interface Spread<T extends unknown[]> {
  items: [string, ...T]
}

/** A view of a rest tuple without its first element, still an array */
export type WithoutFirst = Omit<[number, string, ...boolean[]], '0'>

export interface Strings extends Array<string> {}

type Flags<T> = { [K in keyof T]?: true }

/** A mapped type changing the values of an array's members, also its `length`, so no array */
export type StringFlags = Flags<Strings>
