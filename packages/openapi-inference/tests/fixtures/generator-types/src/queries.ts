import type Anonymous from './anonymous-class'

/** A deep view through a conditional type, whose instantiations keep no alias */
type DeepView<T> = T extends object ? { readonly [K in keyof T]: DeepView<T[K]> } : T

/** A deep view sending strings as numbers */
type DeepLoose<T> = T extends string
  ? number
  : T extends object
    ? { [K in keyof T]: DeepLoose<T[K]> }
    : T

/** A deep view sending numbers as strings */
type DeepNumbers<T> = T extends number
  ? string
  : T extends object
    ? { [K in keyof T]: DeepNumbers<T[K]> }
    : T

/** A deep view whose mapped type is written in parentheses, so its alias declares no mapped type */
// oxfmt-ignore
type ParenthesizedView<T> = ({ readonly [K in keyof T]: ParenthesizedView<T[K]> })

/** A view widening a bigint literal to its primitive */
type Widened<T> = { [K in keyof T]: T[K] extends bigint ? bigint : T[K] }

interface TwinA {
  child: TwinLeaf
  v: string
}

interface TwinB {
  child: TwinLeaf
  v: string
}

interface TwinLeaf {
  twin: TwinA & TwinB
}

/** A view over two interfaces declaring the same properties, through a cycle */
export type TwinsView = DeepLoose<TwinA & TwinB>

/** A view over an instance of a class without a name */
export type AnonymousView = DeepView<Anonymous>

/** A view widening `10n` to `bigint` */
export type WidenedBigInt = Widened<{ n: 10n; s: 'a' }>

interface Named {
  x: string
}

interface Holder {
  inner: Named
}

/** A view of a parenthesized mapped type, compared value by value */
export type ParenthesizedHolder = ParenthesizedView<Holder>

/** A model of a nested namespace, of a declaration file that also declares a shorthand module */
export type NestedItem = GeneratorModels.Nested.Item

interface Ring {
  a: RingA
  b: RingB
  bad: Bad
}

interface RingA {
  b: RingB
  ring: Ring
}

interface RingB {
  a: RingA
}

interface Bad {
  n: number
}

interface RingOwnerA {
  inner: Ring
  v: string
}

interface RingOwnerB {
  inner: Ring
  v: string
}

/**
 * A view over two interfaces holding a ring of models, whose pairs are found kept assuming the
 * pairs enclosing them, until a later value shows the ring is not kept
 */
export type RingView = DeepNumbers<RingOwnerA & RingOwnerB>
