import { os, type } from '@orpc/server'

/** Dates intersected with views of a date, whose `toJSON` is the date's own */
export class DateViewHolder {
  dr: Date & Readonly<Date> = new Date(0)
  dp: Date & Pick<Date, 'toJSON'> = new Date(0)
  dg: Date & Pick<Date, 'getTime'> = new Date(0)
}

/** A value an instance of a class implementing it writes as nothing */
export interface UndefPoint {
  x: number
  toJSON(): undefined
}

export class UndefPointImpl implements UndefPoint {
  x = 1

  toJSON(): undefined {
    return undefined
  }
}

export const roundFifty = {
  dateViewHolder: os.handler((): DateViewHolder => new DateViewHolder()),
  plainUndefPoint: os.handler((): { p: UndefPoint; n: number } => ({
    p: new UndefPointImpl(),
    n: 1,
  })),
}

export const roundFiftyInputs = {
  dateViewHolder: os.input(type<DateViewHolder>()).handler(() => 1),
  undefPoint: os.input(type<{ p: UndefPoint; n: number }>()).handler(() => 1),
}
