/* oxlint-disable typescript/no-wrapper-object-types -- views of boxed primitives returned by toJSON */
import { os, type } from '@orpc/server'

/** Returns a plain view of `Number`, which `JSON.stringify` writes by its own fields */
export class NumberViewOwner {
  toJSON(): Pick<Number, 'valueOf'> {
    return { valueOf: () => 1 }
  }
}

/** Returns a plain view of `Number` with a field */
export class FieldedNumberOwner {
  toJSON(): Pick<Number, 'valueOf'> & { x: string } {
    return { valueOf: () => 1, x: 'x' }
  }
}

/** Returns a plain view of `Boolean` */
export class BooleanViewOwner {
  toJSON(): Pick<Boolean, 'valueOf'> {
    return { valueOf: () => true }
  }
}

/** Plain views of the interface of a boxed primitive returned by `toJSON` */
export interface BoxedViewResults {
  number: NumberViewOwner
  fielded: FieldedNumberOwner
  boolean: BooleanViewOwner
  string: Error & { toJSON(): Pick<String, 'valueOf'> }
  partial: Error & { toJSON(): Partial<Number> }
  relayed: Error & { toJSON(): Pick<String, 'valueOf'> & { toJSON(): string } }
  error: Error & { toJSON(): Pick<Number, 'valueOf'> }
}

const errorJson = <T>(json: T) => Object.assign(new Error('x'), { toJSON: () => json })

export const boxedViewResults = (): BoxedViewResults => ({
  number: new NumberViewOwner(),
  fielded: new FieldedNumberOwner(),
  boolean: new BooleanViewOwner(),
  string: errorJson({ valueOf: () => 's' }),
  partial: errorJson({}),
  relayed: errorJson({ valueOf: () => 's', toJSON: () => 't' }),
  error: errorJson({ valueOf: () => 1 }),
})

/** An interface extending a readonly set, which the serializer writes as the set */
export interface ReadonlyTagSet extends ReadonlySet<string> {
  toJSON(): (() => number) & { toJSON(): number }
}

export interface ReadonlyCodeSet extends ReadonlySet<'a' | 'b'> {
  toJSON(): string
}

export interface ReadonlyFlagSet extends ReadonlySet<boolean> {
  toJSON(): () => number
}

export interface ReadonlyTextMap extends ReadonlyMap<'a' | 'b', boolean> {
  toJSON(): string
}

export interface ReadonlySets {
  relay: ReadonlyTagSet
  text: ReadonlyCodeSet
  call: ReadonlyFlagSet
  map: ReadonlyTextMap
}

export const readonlySets = (): ReadonlySets => ({
  relay: Object.assign(new Set(['a']), {
    toJSON: () => Object.assign(() => 1, { toJSON: () => 2 }),
  }),
  text: Object.assign(new Set(['a' as const]), { toJSON: () => 't' }),
  call: Object.assign(new Set([true]), { toJSON: () => () => 1 }),
  map: Object.assign(new Map([['a' as const, true]]), { toJSON: () => 't' }),
})

export const roundFiftySix = {
  numberViewOwner: os.handler((): NumberViewOwner => new NumberViewOwner()),
  boxedViewResults: os.handler(boxedViewResults),
  readonlySets: os.handler(readonlySets),
}

export const roundFiftySixInputs = {
  boxedViewResults: os.input(type<BoxedViewResults>()).handler(() => 1),
  readonlySets: os.input(type<ReadonlySets>()).handler(() => 1),
}
