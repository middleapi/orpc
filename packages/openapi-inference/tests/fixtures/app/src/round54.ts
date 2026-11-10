/* oxlint-disable typescript/no-wrapper-object-types -- views of a boxed number with a toJSON */
import { os, type } from '@orpc/server'

/** Views of an intersection adding `toJSON` to a view of an error, whose instances `JSON.stringify` writes by it */
export interface ErrorViewMix {
  picked: Readonly<Pick<Error, 'message'> & { toJSON(): string }>
  partial: Partial<Pick<Error, 'message'> & { toJSON(): string | undefined }>
  viewed: Readonly<Readonly<Error> & { toJSON(): string }>
  numbered: Partial<Readonly<Error> & { toJSON(): number }>
  errors: Partial<Pick<Error, 'message'> & { toJSON(): Array<Error> }>
}

/** Also of a view of a boxed number */
export type NumberViewJson = Readonly<Readonly<Number> & { toJSON(): string }>

/** An interface extending a view of a date, written by its own fields when `toJSON` returns it */
export interface ZonedInstant extends Readonly<Date> {
  zone: string
}

export interface ZonedError extends TypeError {
  toJSON(): ZonedInstant
}

/** Interfaces extending a view of a set or a URL, written by their own fields when `toJSON` returns them */
export interface LabeledSet extends Readonly<Set<string>> {
  label: string
}

export interface LabeledHref extends Pick<URL, 'href'> {
  label: string
}

export class LabeledOwner {
  constructor(private readonly plain = false) {}

  toJSON(): { set: LabeledSet; href: LabeledHref } {
    return {
      set: Object.assign(new Set(['a']), { label: 's' }),
      href: this.plain
        ? { href: 'http://a/', label: 'h' }
        : Object.assign(new URL('http://a/'), { label: 'h' }),
    }
  }
}

const errorJson = <T>(json: T) => Object.assign(new Error('x'), { toJSON: () => json })

export const errorViewMix = (): ErrorViewMix => ({
  picked: errorJson('s'),
  partial: errorJson('u0'),
  viewed: errorJson('v'),
  numbered: errorJson(1),
  errors: errorJson([new Error('a'), new Error('b')]),
})

export const plainErrorViewMix = (): ErrorViewMix => ({
  picked: { message: 'p', toJSON: () => 's' },
  partial: { message: 'p' },
  viewed: { name: 'E', message: 'p', toJSON: () => 'v' },
  numbered: {},
  errors: { message: 'p' },
})

export const numberViewJson = (): NumberViewJson =>
  Object.assign(new Number(1), { toJSON: () => 'n' })

export const zonedError = (): ZonedError =>
  Object.assign(new TypeError('e'), { toJSON: () => Object.assign(new Date(0), { zone: 'z' }) })

export const roundFiftyFour = {
  errorViewMix: os.handler(errorViewMix),
  plainErrorViewMix: os.handler(plainErrorViewMix),
  errorViewMixRoot: os.handler((): ErrorViewMix['picked'] => errorJson('s')),
  numberViewJson: os.handler(numberViewJson),
  numberViewJsonHolder: os.handler((): { n: NumberViewJson } => ({ n: numberViewJson() })),
  zonedError: os.handler(zonedError),
  labeledOwners: os.handler((): LabeledOwner[] => [new LabeledOwner(), new LabeledOwner(true)]),
  zonedErrorHolder: os.handler((): { error: ZonedError } => ({ error: zonedError() })),
}

export const roundFiftyFourInputs = {
  errorViewMix: os.input(type<ErrorViewMix>()).handler(() => 1),
  numberViewJson: os.input(type<{ n: NumberViewJson }>()).handler(() => 1),
  zonedError: os.input(type<{ error: ZonedError }>()).handler(() => 1),
}
