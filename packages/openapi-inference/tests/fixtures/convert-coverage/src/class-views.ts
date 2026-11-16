interface Labelled {
  label: string
}

/** An interface extending a built-in and a view of a model */
export interface LabelledSet extends Set<string>, Pick<Labelled, 'label'> {}

/** A view of it, whose only source with a built-in form is the interface over a view */
export type LabelledSetView = Readonly<LabelledSet>

/** A built-in subclass with a private member */
export class Stamp extends Date {
  private stamped = true
}

/** An interface over it, adding a `toJSON` the serializer does not call of a date */
export interface JsonStamp extends Stamp {
  toJSON(): 'stamp'
}

/** A class with a private member, extending no built-in */
export class Owner {
  private owned = true
  name = ''
}

/** A view of the built-in subclass and the class, which only instances satisfy */
export type StampOwner = Pick<Stamp, 'getTime'> & Owner

/** A boxed number subclass with a private member */
export class Amount extends Number {
  private counted = true
}

/** An interface over it, adding a `toJSON` the class does not have */
export interface JsonAmount extends Amount {
  toJSON(): string
}

/** An interface over it, adding a `toJSON` an instance may lack */
export interface MaybeJsonAmount extends Amount {
  toJSON?(): string
}

class Inner {
  a = 1
}

class Outer {
  inner!: Inner & { b: string }
}

/** A view of a class, holding a view of another one */
export type OuterView = Readonly<Outer>

/** A class over a type parameter constrained to a built-in */
export class TagBox<T extends Set<string>> {
  tags!: T
  previous!: T
}
