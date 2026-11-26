/* oxlint-disable typescript/no-wrapper-object-types -- boxed primitives with an added `toJSON` */
import { os, type } from '@orpc/server'

/** A class extending a built-in error, which an intersection adds a `toJSON` to */
export class SubErr extends TypeError {}

export type SubErrJson = SubErr & { toJSON(): string }

/** A class extending none, which an intersection adds a `toJSON` to */
export class Spot {
  x = 1
}

export type SpotJson = Spot & { toJSON(): string }

/** Views of an error with an added `toJSON`, which `JSON.stringify` calls on an instance */
export interface ErrorViewJson {
  pe: Pick<Error, 'message'> & { toJSON(): string }
  re: Readonly<Error> & { toJSON(): string }
  rx: Readonly<Error & { toJSON(): string }>
}

/** Boxed primitives with an added `toJSON` */
export interface BoxedJson {
  n: Number & { toJSON(): string }
  s: String & { toJSON(): number }
  b: Boolean & { toJSON(): string }
}

/** Views of built-ins with an added `toJSON` in a class instance, which `JSON.stringify` writes */
export class ViewJsonHolder {
  d: Readonly<Date & { toJSON(): number }> = Object.assign(new Date(0), { toJSON: () => 1 })
  e: Readonly<Error & { toJSON(): number }> = Object.assign(new Error('e'), { toJSON: () => 2 })
  p: Pick<Error, 'message'> & { toJSON(): number } = { message: 'p', toJSON: () => 3 }
  n: Number & { toJSON(): string } = Object.assign(new Number(1), { toJSON: () => 'n' })
}

const withToJSON = <T extends object>(value: T, json: string): T & { toJSON(): string } =>
  Object.assign(value, { toJSON: () => json })

export const subErrJson = (): { e: SubErrJson; p: SpotJson } => ({
  e: withToJSON(new SubErr('x'), 's'),
  p: withToJSON(new Spot(), 'p'),
})

export const errorViewJson = (): ErrorViewJson => ({
  pe: withToJSON(new Error('p'), 'pe'),
  re: withToJSON(new Error('r'), 're'),
  rx: withToJSON(new Error('x'), 'rx'),
})

export const plainErrorViewJson = (): ErrorViewJson => ({
  pe: { message: 'p', toJSON: () => 'pe' },
  re: { name: 'Error', message: 'r', toJSON: () => 're' },
  rx: { name: 'Error', message: 'x', toJSON: () => 'rx' },
})

export const boxedJson = (): BoxedJson => ({
  n: withToJSON(new Number(1), 'n'),
  s: Object.assign(new String('s'), { toJSON: () => 2 }),
  b: withToJSON(new Boolean(true), 'b'),
})

export const intersectedToJson = {
  subErrJson: os.handler(subErrJson),
  errorViewJson: os.handler(errorViewJson),
  plainErrorViewJson: os.handler(plainErrorViewJson),
  boxedJson: os.handler(boxedJson),
  viewJsonHolder: os.handler((): ViewJsonHolder => new ViewJsonHolder()),
}

export const intersectedToJsonInputs = {
  subErrJson: os.input(type<{ e: SubErrJson; p: SpotJson }>()).handler(() => 1),
  errorViewJson: os.input(type<ErrorViewJson>()).handler(() => 1),
  boxedJson: os.input(type<BoxedJson>()).handler(() => 1),
}
