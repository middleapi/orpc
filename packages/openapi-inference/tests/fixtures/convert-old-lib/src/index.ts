/** A class instance, which `JSON.stringify` writes, holding a bigint, which it can not write */
export class Counter {
  count!: bigint
}

/** A view of the class, which holds an instance or a plain object */
export type CounterView = Readonly<Counter>

/** A set subclass, which no iterator of the library tells the items of */
export class Tags extends Set<string> {}
