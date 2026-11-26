import type TwoFactor from './2fa'
import type Widget from './widget'

export interface Page<T> {
  items: T
}

export interface Box<T> {
  value: T
}

/** A type argument of a readonly array of object literals */
export interface ReadonlyRows {
  page: Page<readonly { id: number }[]>
}

export interface __ {
  a: string
}

/** A type whose name is only underscores, like the internal names of the compiler */
export interface Underscored {
  value: __
}

/** Anonymous classes, of an index file and of a file whose name starts with a digit */
export interface DefaultExports {
  widget: Widget
  twoFactor: TwoFactor
}

export const Chain = class {
  value = 0
  next?: this
}

/** An instance of a class expression referring to itself */
export interface Chains {
  chain: InstanceType<typeof Chain>
}

export interface Node<T> {
  value: T
  next?: Node<T>
}

declare function unbox<T>(boxes: { [K in keyof T]: Box<T[K]> }): Node<T>
const unboxed = unbox({ a: { value: 1 } })

/** An instantiation over a type the compiler inferred, which has no symbol */
export interface Inferred {
  node: typeof unboxed
}

type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never }
type XOR<T, U> = T extends object
  ? U extends object
    ? ((Without<T, U> & U) | (Without<U, T> & T)) & object
    : U
  : T

export type FilterOrWhere = XOR<Filter, Where>

export interface Filter {
  is?: Where
}

/** A cycle through an alias without type arguments, which the type it is written for lost */
export interface Where {
  id?: number
  author?: FilterOrWhere
}
