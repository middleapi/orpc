import { os } from '@orpc/server'
import type { ReadonlyDeep } from 'type-fest'
import type * as z from 'zod'

/** A field typed by a function with properties, which `ReadonlyDeep` maps to an intersection */
export class Gadget {
  onClick?: { (): void; label: string }
  tags = new Set(['a'])
}

export class GadgetShelf {
  byName = new Map<string, Gadget>([['g', new Gadget()]])
  featured: Gadget | null = new Gadget()
}

/** A primitive branded by an alias, which declares the brand apart from the intersection */
export type Cents = number & z.BRAND<'Cents'>

/** A deep partial type mapping every object, branded primitives too */
export type LooseDeep<T> = T extends Date
  ? T
  : T extends object
    ? { [K in keyof T]?: LooseDeep<T[K]> }
    : T

export class Invoice {
  total = 5 as Cents
  lines: Cents[] = [2 as Cents]
}

export const roundSixtyFour = {
  readonlyGadget: os.handler((): ReadonlyDeep<Gadget> => new Gadget()),
  readonlyGadgetShelf: os.handler((): ReadonlyDeep<GadgetShelf> => new GadgetShelf()),
  looseCents: os.handler((): LooseDeep<Cents> => 5 as Cents),
  mappedCents: os.handler((): { [K in keyof Cents]: Cents[K] } => 5 as Cents),
  looseInvoice: os.handler((): LooseDeep<Invoice> => new Invoice()),
}
