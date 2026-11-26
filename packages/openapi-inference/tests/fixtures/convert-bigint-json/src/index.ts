declare global {
  interface BigInt {
    toJSON(): string
  }
}

export class Ledger {
  total = 1n
}

/** A view of a class, which holds an instance or a plain object */
export type LedgerView = Readonly<Ledger>
