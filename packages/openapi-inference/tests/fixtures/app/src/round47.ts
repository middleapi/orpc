import { os, type } from '@orpc/server'

/** Sent as its label, or left out without one */
export class MaybeLabel {
  constructor(private readonly label?: string) {}

  toJSON(): string | undefined {
    return this.label
  }
}

export const roundFortySeven = {
  // an instance whose `toJSON` returns `undefined` leaves the error's `data` out
  unlabelledData: os
    .errors({ UNLABELLED: { data: type<MaybeLabel>() } })
    .handler(({ errors }): number => {
      throw errors.UNLABELLED({ data: new MaybeLabel() })
    }),
  unlabelledViewData: os
    .errors({ UNLABELLED_VIEW: { data: type<Readonly<MaybeLabel> | null>() } })
    .handler(({ errors }): number => {
      throw errors.UNLABELLED_VIEW({ data: new MaybeLabel() })
    }),
  // an error's `data` is not awaited, so a promise is sent as `{}`
  promisedData: os
    .errors({ PROMISED: { data: type<Promise<string>>() } })
    .handler(({ errors }): number => {
      throw errors.PROMISED({ data: Promise.resolve('s') })
    }),
}
