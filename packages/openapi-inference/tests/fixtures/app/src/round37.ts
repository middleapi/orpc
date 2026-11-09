import { os, type } from '@orpc/server'

/** Expands each value again */
type Expanding<T> = T extends object ? { [K in keyof T]: Expanding<T[K]> } : T

/** Each value, read-only, deeply */
type ConditionalDeep<T> = T extends object ? { readonly [K in keyof T]: ConditionalDeep<T[K]> } : T

/** A generic model holding an expanding view of itself, beside an object literal field */
export interface GenericCycle<T> {
  f0: Expanding<GenericCycle<T>> | null
  f2: { a: T }
}

/** A generic model holding a deep view of itself */
export interface GenericSelf<T> {
  v: T
  self: ConditionalDeep<GenericSelf<T>> | null
}

/** A generic model holding an expanding view of itself beside its type argument */
export interface WrapCycle<T> {
  inner: T
  f0: Expanding<WrapCycle<T>> | null
}

/** A generic model nesting itself with growing type arguments */
export interface GrowingPair<T> {
  v: T
  nested: GrowingPair<T[]> | null
}

export interface Box<T> {
  v: T
}

/** A generic model nesting its type argument through another generic model, cut after a few levels */
export interface BoxVia<T> {
  inner: Box<T>
}

/**
 * Conditional deep mapped types over cycles through generic models, which are cut, and over a
 * generic model nested in itself, which ends.
 */
export const roundThirtySeven = {
  genericCycle: os.handler((): GenericCycle<number> => ({
    f0: { f0: null, f2: { a: 2 } },
    f2: { a: 1 },
  })),
  genericSelf: os.handler((): GenericSelf<string> => ({ v: 'a', self: { v: 'b', self: null } })),
  wrapCycle: os.handler((): WrapCycle<{ a: number }> => ({
    inner: { a: 1 },
    f0: { inner: { a: 2 }, f0: null },
  })),
  growingPair: os.handler((): ConditionalDeep<GrowingPair<number>> => ({
    v: 1,
    nested: { v: [1], nested: null },
  })),
  deepBoxes: os.handler((): ConditionalDeep<Box<Box<Box<Box<Box<Box<Box<Box<number>>>>>>>>> => ({
    v: { v: { v: { v: { v: { v: { v: { v: 1 } } } } } } },
  })),
  viaBoxes: os.handler(
    (): ConditionalDeep<BoxVia<BoxVia<BoxVia<BoxVia<BoxVia<BoxVia<number>>>>>>> => ({
      inner: {
        v: {
          inner: { v: { inner: { v: { inner: { v: { inner: { v: { inner: { v: 1 } } } } } } } } },
        },
      },
    }),
  ),
}

/** Inputs of the same types, as a client sends them */
export const roundThirtySevenInputs = {
  genericCycle: os.input(type<GenericCycle<number>>()).handler(() => 1),
  genericSelf: os.input(type<GenericSelf<string>>()).handler(() => 1),
  wrapCycle: os.input(type<WrapCycle<{ a: number }>>()).handler(() => 1),
  deepBoxes: os
    .input(type<ConditionalDeep<Box<Box<Box<Box<Box<Box<Box<Box<number>>>>>>>>>>())
    .handler(() => 1),
}
