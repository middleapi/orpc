/* oxlint-disable typescript/no-wrapper-object-types, typescript/no-empty-object-type -- interfaces extending boxed primitives, Function, and weak collections */
import { os, type } from '@orpc/server'

/** An interface extending `WeakMap`, which a `Map` satisfies */
export interface WeakLookup extends WeakMap<object, string> {}

/** An interface extending `WeakSet`, which a `Set` satisfies */
export interface WeakTags extends WeakSet<object> {}

/** A class extending `WeakMap`, which a `Map` satisfies */
export class WeakLookupClass extends WeakMap<object, string> {}

/** Weak collections, which may hold the `Map` or `Set` they are satisfied by */
export interface WeakHolder {
  lookup: WeakLookup
  tags: WeakTags
  lookupClass: WeakLookupClass
}

const key = {}

// `Map` and `Set` satisfy `WeakMap` and `WeakSet`
export const weakHolder = (): WeakHolder => ({
  lookup: new Map([[key, 'a']]),
  tags: new Set([key]),
  lookupClass: new Map([[key, 'b']]),
})

/** An interface extending `Function` with a `toJSON`, which has no call signature */
export interface PlainJsonFn extends Function {
  toJSON(): string
}

/** A plain object typed by it, which the serializer walks without its `toJSON` */
export const plainJsonFn = (): PlainJsonFn => ({
  apply() {},
  call() {},
  bind() {},
  toString: () => '',
  prototype: 1,
  length: 0,
  arguments: 1,
  caller: () => 1,
  name: 'x',
  [Symbol.hasInstance]: () => false,
  toJSON: () => 'x',
})

/** A function typed by it, which `JSON.stringify` writes by its `toJSON` */
export const functionJsonFn = (): PlainJsonFn => Object.assign(() => 1, { toJSON: () => 'f' })

/** Holds a value of an interface extending `Function` */
export interface PlainJsonFnHolder {
  fn: PlainJsonFn
}

/** A subclass of `Number` written by its `toJSON` */
export class JsonNum extends Number {
  toJSON(): string {
    return 'jn'
  }
}

/** An interface over a readonly view of `Number` with its own `toJSON` */
export interface ReadonlyJsonNum extends Readonly<Number> {
  toJSON(): string
}

/** An interface over a picked view of `Number` with its own `toJSON` */
export interface PickedJsonNum extends Pick<Number, 'valueOf'> {
  toJSON(): string
}

/** Views of interfaces over views of `Number` with their own `toJSON` */
export interface NumViewJsons {
  readonlyView: Readonly<ReadonlyJsonNum>
  codedView: ReadonlyJsonNum & { code: number }
  pickedView: Pick<ReadonlyJsonNum, 'toJSON'>
  readonlyPicked: Readonly<PickedJsonNum>
  codedPicked: PickedJsonNum & { code: number }
  pickedPicked: Pick<PickedJsonNum, 'toJSON'>
}

const jsonNum = () => new JsonNum(1)

export const numViewJsons = (): NumViewJsons => ({
  readonlyView: jsonNum(),
  codedView: Object.assign(jsonNum(), { code: 1 }),
  pickedView: jsonNum(),
  readonlyPicked: jsonNum(),
  codedPicked: Object.assign(jsonNum(), { code: 1 }),
  pickedPicked: jsonNum(),
})

/** An interface extending `Number` */
export interface NumLike extends Number {}

/** An interface extending `Number` with a field */
export interface FieldedNumLike extends Number {
  x: string
}

/** Interfaces extending `Number`, which a plain object may satisfy */
export interface NumLikes {
  bare: NumLike
  fielded: FieldedNumLike
}

const numberMethods = {
  toFixed: () => '1',
  toExponential: () => '1',
  toPrecision: () => '1',
  toString: () => '1',
  toLocaleString: () => '1',
  valueOf: () => 1,
}

export const plainNumLikes = (): NumLikes => ({
  bare: numberMethods,
  fielded: { ...numberMethods, x: 'a' },
})

export const boxedNumLikes = (): NumLikes => ({
  bare: new Number(1),
  fielded: Object.assign(new Number(2), { x: 'a' }),
})

export const roundSixty = {
  weakHolder: os.handler(weakHolder),
  plainJsonFnRoot: os.handler(plainJsonFn),
  plainJsonFnHolder: os.handler((): PlainJsonFnHolder => ({ fn: plainJsonFn() })),
  functionJsonFnHolder: os.handler((): PlainJsonFnHolder => ({ fn: functionJsonFn() })),
  numViewJsons: os.handler(numViewJsons),
  plainNumLikes: os.handler(plainNumLikes),
  boxedNumLikes: os.handler(boxedNumLikes),
}

export const roundSixtyInputs = {
  weakHolder: os.input(type<WeakHolder>()).handler(() => 1),
  plainJsonFnRoot: os.input(type<PlainJsonFn>()).handler(() => 1),
  plainJsonFnHolder: os.input(type<PlainJsonFnHolder>()).handler(() => 1),
  numViewJsons: os.input(type<NumViewJsons>()).handler(() => 1),
  numLikes: os.input(type<NumLikes>()).handler(() => 1),
}
