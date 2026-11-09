// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

export interface Circle {
  kind: 'circle'
  radius: number
}

export interface Square {
  kind: 'square'
  size: number
}

/** A shape, told apart by its kind */
export type Shape = Circle | Square

/** Of either of two kinds */
export interface Ellipse {
  kind: 'circle' | 'ellipse'
  radii: [number, number]
}

/** A circle by another name, its kind clashes with `Circle` */
export interface Disc {
  kind: 'circle'
  diameter: number
}

/** Its kind may be left out */
export interface MaybeKind {
  kind?: 'maybe'
}

/** Sent by `toJSON` with another kind */
export class Relabelled {
  kind = 'relabelled' as const

  toJSON(): { kind: 'renamed'; size: number } {
    return { kind: 'renamed', size: 1 }
  }
}

/** Its instances are written with another kind than its plain objects */
export class Labelled {
  kind = 'labelled' as const

  toJSON(): { kind: 'json' } {
    return { kind: 'json' }
  }
}

export enum ShapeKind {
  Round = 'round',
  Flat = 'flat',
}

export interface RoundShape {
  kind: ShapeKind.Round
  radius: number
}

export interface FlatShape {
  kind: ShapeKind.Flat
  size: number
}

export interface Leaf {
  kind: 'leaf'
  value: number
}

export interface Branch {
  kind: 'branch'
  children: Tree[]
}

/** A tree of leaves */
export type Tree = Leaf | Branch

// each of these unions, named
export type Rounded = Ellipse | Square
export type Clashing = Circle | Disc
export type MaybeKinds = MaybeKind | Square
export type ShapeOrText = Shape | string
export type RelabelledShape = Relabelled | Square
export type LabelledView = Readonly<Labelled> | Square
export type KindEnumShape = RoundShape | FlatShape

const circle: Circle = { kind: 'circle', radius: 1 }
const square: Square = { kind: 'square', size: 2 }

export const roundThirtyNine = {
  shapes: os.handler((): Shape[] => [circle, square]),
  maybeShape: os.handler((): Shape | null => null),
  maybeShapes: os.handler((): (Circle | Square | null)[] => [circle, square, null]),
  rounded: os.handler((): (Ellipse | Square)[] => [
    { kind: 'ellipse', radii: [1, 2] },
    { kind: 'circle', radii: [1, 1] },
    square,
  ]),
  clashing: os.handler((): (Circle | Disc)[] => [circle, { kind: 'circle', diameter: 2 }]),
  maybeKinds: os.handler((): (MaybeKind | Square)[] => [{}, { kind: 'maybe' }, square]),
  withText: os.handler((): (Shape | string)[] => [circle, 'text']),
  relabelled: os.handler((): (Relabelled | Square)[] => [new Relabelled(), square]),
  labelledViews: os.handler((): (Readonly<Labelled> | Square)[] => [
    new Labelled(),
    // a plain object the serializer walks, not calling its `toJSON`
    { kind: 'labelled', toJSON: () => ({ kind: 'json' }) },
    square,
  ]),
  enumShapes: os.handler((): (RoundShape | FlatShape)[] => [
    { kind: ShapeKind.Round, radius: 1 },
    { kind: ShapeKind.Flat, size: 2 },
  ]),
  treeBranch: os.handler((): Branch => ({
    kind: 'branch',
    children: [
      { kind: 'leaf', value: 1 },
      { kind: 'branch', children: [] },
    ],
  })),
  shapeTree: os.handler((): Tree => ({ kind: 'leaf', value: 1 })),
}

/** Inputs of the same types, as a client sends them */
export const roundThirtyNineInputs = {
  shape: os.input(type<Shape>()).handler(() => 1),
  relabelled: os.input(type<Relabelled | Square>()).handler(() => 1),
  queried: os
    .route({ method: 'GET' })
    .input(type<Shape>())
    .handler(() => 1),
}
