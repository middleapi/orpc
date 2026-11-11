import { os } from '@orpc/server'

export interface Page<T> {
  items: T[]
  total: number
}
export interface Invoice {
  number: string
}

const page = { items: [], total: 0 }

/** Instantiations over object literals, named by their keys, apart from those over named types */
export const roundEightyOneNames = {
  // before the ones over named types, which keep their names
  invoices: os.handler((): Page<{ number: string }> => page),
  byInvoice: os.handler((): Page<{ Invoice: string }> => page),
  counts: os.handler((): Page<number> => page),
  named: os.handler((): Page<Invoice> => page),
  // keys starting with `_`, like the aggregates of an ORM
  aggregates: os.handler((): Page<{ _avg: number; _sum: number }> => page),
}

/** The same in the other order */
export const roundEightyOneNamesReversed = {
  named: os.handler((): Page<Invoice> => page),
  counts: os.handler((): Page<number> => page),
  byInvoice: os.handler((): Page<{ Invoice: string }> => page),
  invoices: os.handler((): Page<{ number: string }> => page),
  aggregates: os.handler((): Page<{ _avg: number; _sum: number }> => page),
}

/** Instantiations over intersections of object literals, named by their keys */
export const roundEightyOneIntersections = {
  merged: os.handler((): Page<{ id: number } & { title: string }> => page),
  mergedRows: os.handler((): Page<({ id: number } & { title: string })[]> => page),
}

/** A class whose `toJSON` is typed `object`, which may write any value */
export class AnyJSON {
  a = 1
  toJSON: object = () => ({ q: 1 })
}

/** Outputs that may be left out, which admit `null` already */
export const roundEightyOneBodies = {
  nullOrUndefined: os.handler((): null | undefined => null),
  maybeNull: os.handler((): string | null | undefined => null),
  anyJSON: os.handler((): AnyJSON => new AnyJSON()),
  maybeAnyJSON: os.handler((): AnyJSON | undefined => new AnyJSON()),
}
