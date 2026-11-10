import { os, type } from '@orpc/server'

/** Sent by an instance as its `toJSON` */
export class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}

  toJSON(): string {
    return `${this.amount} ${this.currency}`
  }
}

/** Its `Set` and `Map` fields are sent by an instance as `{}` */
export class Tagged {
  tags = new Set(['a'])
  counts = new Map([['a', 1]])
  name = 'n'
}

/** An instance leaves its getter out */
export class Person {
  first = 'a'
  last = 'b'

  get full(): string {
    return `${this.first} ${this.last}`
  }
}

/** Holds instances of other classes */
export class Order {
  total = new Money(1, 'X')
  items = [new Tagged()]
}

/** Only an instance type-checks */
export class Sealed {
  #secret = 's'
  tags = new Set(['a'])

  reveal(): string {
    return this.#secret
  }
}

/** Only an instance type-checks, which `JSON.stringify` writes with the classes it holds */
export class Guarded {
  private hidden = 'h'
  price = new Money(1, 'X')
  slot = { tags: new Set(['a']), item: new Tagged() }

  reveal(): string {
    return this.hidden
  }
}

export class Stamp extends Date {
  label = 'l'
}

export class Link extends URL {
  label = 'l'
}

export class Labels extends Set<string> {
  label = 'l'
}

export class Lookup extends Map<string, number> {
  label = 'l'
}

/** Class types a client may send as instances or as plain objects */
export const classInputs = {
  // before `Tagged` itself, which it holds as an instance
  guarded: os.input(type<{ g: Guarded }>()).handler(() => 1),
  money: os.input(type<{ m: Money }>()).handler(() => 1),
  tagged: os.input(type<Tagged>()).handler(() => 1),
  person: os.input(type<Person>()).handler(() => 1),
  readonlyTagged: os.input(type<Readonly<Tagged>>()).handler(() => 1),
  pickedMoney: os.input(type<Pick<Money, 'amount'>>()).handler(() => 1),
  partialPerson: os.input(type<Partial<Person>>()).handler(() => 1),
  order: os.input(type<Order>()).handler(() => 1),
  readonlyOrder: os.input(type<Readonly<Order>>()).handler(() => 1),
  moneys: os.input(type<Money[]>()).handler(() => 1),
  tags: os.input(type<{ list: Tagged[] }>()).handler(() => 1),
  sealed: os.input(type<Sealed>()).handler(() => 1),
  stamp: os.input(type<Stamp>()).handler(() => 1),
  link: os.input(type<Link>()).handler(() => 1),
  labels: os.input(type<Labels>()).handler(() => 1),
  lookup: os.input(type<Lookup>()).handler(() => 1),
}
