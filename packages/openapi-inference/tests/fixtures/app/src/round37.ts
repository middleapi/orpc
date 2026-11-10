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

/** Its type argument beside a function returning it, which a deep mapped type maps to a `{}` */
type WithGetter<T> = { a: T; f: () => T }

/** A generic model nesting its type argument through an alias holding a function */
export interface ViaGetter<T> {
  inner: WithGetter<T>
}

/** A generic model nesting its type argument through an object literal holding a map of it */
export interface ViaMapLiteral<T> {
  inner: { a: T; m: Map<string, T> }
}

/** Its type argument beside a function returning it, in a list linking more of them */
type LinkedGetter<T> = { a: T; f: () => T; next: LinkedGetter<T> | null }

/** A generic model nesting its type argument through an alias naming itself, not the model */
export interface ViaLinkedGetter<T> {
  inner: LinkedGetter<T>
}

/** A generic model nesting its type argument through an object literal holding a map of itself */
export interface ViaSelfMap<T> {
  inner: { a: T; m: Map<string, ViaSelfMap<T>> }
}

/** A generic model nesting its type argument through an object literal holding a set of itself */
export interface ViaSelfSet<T> {
  inner: { a: T; s: Set<ViaSelfSet<T>> }
}

/** Its type argument beside a function returning it, and the model holding it */
type WithParent<T> = { a: T; f: () => T; up: ViaParent<T> | null }

/** A generic model nesting its type argument through an alias pointing back to it */
export interface ViaParent<T> {
  inner: WithParent<T>
}

const viaGetter = <T>(a: T): ViaGetter<T> => ({ inner: { a, f: () => a } })
const viaMapLiteral = <T>(a: T): ViaMapLiteral<T> => ({ inner: { a, m: new Map([['k', a]]) } })
const viaSelfMap = <T>(a: T): ViaSelfMap<T> => {
  const model: ViaSelfMap<T> = { inner: { a, m: new Map() } }
  model.inner.m.set('k', { inner: { a, m: new Map() } })
  return model
}
const viaSelfSet = <T>(a: T): ViaSelfSet<T> => ({
  inner: { a, s: new Set([{ inner: { a, s: new Set() } }]) },
})
const viaParent = <T>(a: T): ViaParent<T> => {
  const model: ViaParent<T> = { inner: { a, f: () => a, up: null } }
  return { inner: { a, f: () => a, up: model } }
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
  viaGetters: os.handler(
    (): ConditionalDeep<ViaGetter<ViaGetter<ViaGetter<ViaGetter<ViaGetter<ViaGetter<number>>>>>>> =>
      viaGetter(viaGetter(viaGetter(viaGetter(viaGetter(viaGetter(1)))))),
  ),
  viaMapLiterals: os.handler(
    (): Expanding<
      ViaMapLiteral<ViaMapLiteral<ViaMapLiteral<ViaMapLiteral<ViaMapLiteral<number>>>>>
    > => viaMapLiteral(viaMapLiteral(viaMapLiteral(viaMapLiteral(viaMapLiteral(1))))),
  ),
  viaSelfMaps: os.handler(
    (): ConditionalDeep<
      ViaSelfMap<ViaSelfMap<ViaSelfMap<ViaSelfMap<ViaSelfMap<ViaSelfMap<number>>>>>>
    > => viaSelfMap(viaSelfMap(viaSelfMap(viaSelfMap(viaSelfMap(viaSelfMap(1)))))),
  ),
  viaSelfSets: os.handler(
    (): Expanding<ViaSelfSet<ViaSelfSet<ViaSelfSet<ViaSelfSet<ViaSelfSet<number>>>>>> =>
      viaSelfSet(viaSelfSet(viaSelfSet(viaSelfSet(viaSelfSet(1))))),
  ),
  viaParents: os.handler(
    (): ConditionalDeep<ViaParent<ViaParent<ViaParent<ViaParent<ViaParent<ViaParent<number>>>>>>> =>
      viaParent(viaParent(viaParent(viaParent(viaParent(viaParent(1)))))),
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
  viaGetters: os
    .input(
      type<
        ConditionalDeep<ViaGetter<ViaGetter<ViaGetter<ViaGetter<ViaGetter<ViaGetter<number>>>>>>>
      >(),
    )
    .handler(() => 1),
  viaLinkedGetters: os
    .input(
      type<
        Expanding<
          ViaLinkedGetter<
            ViaLinkedGetter<
              ViaLinkedGetter<ViaLinkedGetter<ViaLinkedGetter<ViaLinkedGetter<number>>>>
            >
          >
        >
      >(),
    )
    .handler(() => 1),
  viaSelfMaps: os
    .input(
      type<
        ConditionalDeep<
          ViaSelfMap<
            ViaSelfMap<
              ViaSelfMap<ViaSelfMap<ViaSelfMap<ViaSelfMap<ViaSelfMap<ViaSelfMap<number>>>>>>
            >
          >
        >
      >(),
    )
    .handler(() => 1),
  viaSelfSets: os
    .input(type<Expanding<ViaSelfSet<ViaSelfSet<ViaSelfSet<ViaSelfSet<ViaSelfSet<number>>>>>>>())
    .handler(() => 1),
}
