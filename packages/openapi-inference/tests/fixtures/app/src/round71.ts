import { os, type } from '@orpc/server'
import type { NegativeInfinity, PositiveInfinity, TupleToObject } from 'type-fest'

/** Limits the compiler can not send the type of, which JSON writes as `null` */
export interface Limits {
  max: PositiveInfinity
  min: NegativeInfinity
  step: number
}

export interface Point {
  x: number
  label?: string
}

/** An object type of indexes, which a tuple satisfies */
export type IndexedPoint = TupleToObject<[Point, number, string?]>

export const roundSeventyOne = {
  limits: os.handler((): Limits => ({
    max: Infinity as PositiveInfinity,
    min: -Infinity as NegativeInfinity,
    step: 1,
  })),
  infinite: os.handler((): PositiveInfinity | 'none' => Infinity as PositiveInfinity),
  limitsInput: os.input(type<{ limits?: Limits }>()).handler(() => 1),
  indexedObject: os.handler((): IndexedPoint => ({ 0: { x: 1 }, 1: 2 })),
  indexedTuple: os.handler((): IndexedPoint => [{ x: 1, label: 'a' }, 2, 'b']),
  indexedDate: os.handler((): { 0: Date; 1?: string } => [new Date(0)]),
}
