export class Money {
  amount = 1

  toJSON(): string {
    return String(this.amount)
  }
}

/** A `toJSON` of a key no call passes, called anyway */
export class NumberKey {
  toJSON(key: number): number {
    return key
  }
}

export interface Tagged {
  tag: string
}

/** A `toJSON` for values of another type */
export class OtherThis {
  toJSON(this: Tagged): string {
    return this.tag
  }
}

/** A `toJSON` for values of its own type */
export class OwnThis {
  tag = 'a'

  toJSON(this: Tagged): boolean {
    return this.tag === 'a'
  }
}

/** A `toJSON` of rest arguments */
export class RestArguments {
  toJSON(...args: string[]): number {
    return args.length
  }
}

/** A `toJSON` of the key and options */
export class KeyAndOptions {
  toJSON(key: string, options?: { pretty: boolean }): string {
    return options?.pretty ? key : ''
  }
}

export interface ToJSONs {
  numberKey: NumberKey
  otherThis: OtherThis
  ownThis: OwnThis
  rest: RestArguments
  keyAndOptions: KeyAndOptions
}

/** A type parameter constrained to a class */
export type OfMoney<T extends Money> = T

/** A branded class intersection */
export type BrandedMoney = string & Money
