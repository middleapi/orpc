// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** A class whose `toJSON` is typed `object` */
export class ObjectJSON {
  a = 1
  toJSON: object = () => ({ q: 1 })
}

/** A class whose `toJSON` is typed `{}` */
export class EmptyTypeJSON {
  a = 1
  // oxlint-disable-next-line typescript/no-empty-object-type
  toJSON: {} = () => ({ q: 1 })
}

/** A class whose `toJSON` is typed `Object` */
export class BoxedObjectJSON {
  a = 1
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  toJSON: Object = () => ({ q: 1 })
}

/** A class whose `toJSON` is typed `object` or a function */
export class ObjectOrFunctionJSON {
  a = 1
  toJSON: object | (() => { w: string }) = () => ({ q: 1 })
}

export type BrandedId = string & { __brand: 'BrandedId' }
export type BrandedNumber = number & { __brand: 'BrandedNumber' }
export type BrandedSymbol = symbol & { __brand: 'BrandedSymbol' }

/** A class with fields, whose keyless views hold anything but `undefined` */
export class KeyedUser {
  id = 'u'
  name = 'n'
}

const id = 'u1' as BrandedId
const sym = Symbol('s')
const brandedSym = sym as BrandedSymbol

/** toJSON typed object, views of branded primitives and symbols, and keyless views of classes */
export const roundThirtyThree = {
  objectToJSON: os.handler(
    (): {
      obj: ObjectJSON
      empty: EmptyTypeJSON
      boxed: BoxedObjectJSON
      union: ObjectOrFunctionJSON
      list: ObjectJSON[]
    } => ({
      obj: new ObjectJSON(),
      empty: new EmptyTypeJSON(),
      boxed: new BoxedObjectJSON(),
      union: new ObjectOrFunctionJSON(),
      list: [new ObjectJSON()],
    }),
  ),
  objectToJSONRoot: os.handler((): ObjectJSON => new ObjectJSON()),
  omittedBrands: os.handler(
    (): {
      omit: Omit<BrandedId, '__brand'>
      pick: Pick<BrandedId, 'length'>
      picked: Pick<BrandedId, 'length'>
      num: Omit<BrandedNumber, '__brand'>
      list: Omit<BrandedId, '__brand'>[]
    } => ({
      omit: id,
      pick: id,
      picked: { length: 2 },
      num: 1 as BrandedNumber,
      list: [id],
    }),
  ),
  omittedBrandRoot: os.handler((): Omit<BrandedId, '__brand'> => id),
  partialBrands: os.handler(
    (): {
      v: Partial<BrandedId>
      x: Partial<BrandedId> & { extra?: string }
      id: Partial<BrandedId>
      list: Partial<BrandedId>[]
    } => ({ v: {}, x: { valueOf: () => 'x', extra: 'x' }, id, list: [{}, id] }),
  ),
  partialBrandRoot: os.handler((): Partial<BrandedId> => ({})),
  keylessClassViews: os.handler(
    (): {
      picked: Pick<KeyedUser, never>
      omitted: Omit<KeyedUser, 'id' | 'name'>
      str: Pick<KeyedUser, never>
      list: Pick<KeyedUser, never>[]
    } => ({ picked: () => 1, omitted: () => 1, str: 'str', list: [() => 1] }),
  ),
  symbolViews: os.handler(
    (): {
      omit: Omit<symbol, 'k'>
      pick: Pick<symbol, 'toString'>
      list: Omit<symbol, 'k'>[]
    } => ({ omit: sym, pick: sym, list: [sym] }),
  ),
  brandedSymbols: os.handler(
    (): {
      v: BrandedSymbol
      r: Readonly<BrandedSymbol>
      x: Readonly<BrandedSymbol> & { extra?: string }
      omit: Omit<BrandedSymbol, '__brand'>
      list: BrandedSymbol[]
      views: Readonly<BrandedSymbol>[]
    } => ({
      v: brandedSym,
      r: brandedSym,
      x: brandedSym,
      omit: brandedSym,
      list: [brandedSym],
      views: [brandedSym],
    }),
  ),
}

/** Inputs of views of branded primitives and keyless views of classes */
export const roundThirtyThreeInputs = {
  omittedBrand: os.input(type<{ v: Omit<BrandedId, '__brand'> }>()).handler(() => 1),
  partialBrand: os.input(type<{ v: Partial<BrandedId> }>()).handler(() => 1),
  keylessClass: os.input(type<{ v: Pick<KeyedUser, never> }>()).handler(() => 1),
}
