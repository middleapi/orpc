import { os, type } from '@orpc/server'

import type { AccessorModel } from './accessor-model'

/** Expands through `Readonly`, each level holds an array of the previous values */
export class Growing<T> {
  next: Readonly<Growing<T[]>> | null = null

  constructor(public value: T) {}
}

export interface GrowingShape<T> {
  value: T
  next: Readonly<GrowingShape<T[]>> | null
}

/** What `accessor x = 1` compiles to: a getter and setter on the prototype */
export class AccessorRuntime {
  #x = 1
  y = 2

  get x(): number {
    return this.#x
  }

  set x(value: number) {
    this.#x = value
  }
}

export class HoldsAccessor {
  v: Readonly<AccessorModel> = new AccessorRuntime()
}

export interface PointJSON {
  a: number
  toJSON(): string
}

export type PointAlias = { b: number; toJSON(): string }

export class HoldsPointJSON {
  inner: PointJSON = { a: 1, toJSON: () => 'inner' }
}

export class PointInstance {
  a = 1

  toJSON(): string {
    return 'instance'
  }
}

export interface DroppingShape {
  a: number
  toJSON(): undefined
}

export class HoldsDroppingShape {
  d: DroppingShape = { a: 2, toJSON: () => undefined }
}

export class DropsJSON {
  a = 1

  toJSON(): undefined {
    return undefined
  }
}

export class HoldsPickedDrops {
  p: Pick<DropsJSON, 'a'> = { a: 3 }
}

export type TaggedFunction = (() => void) & { tag: string }

export interface CallableShape {
  (): void
  tag: string
}

export class HoldsTaggedFunction {
  cb: TaggedFunction = Object.assign(() => {}, { tag: 't' })
  count = 1
  name = 'n'
}

export class Cents {
  constructor(private readonly cents: number) {}

  toJSON(): { amount: number } {
    return { amount: this.cents }
  }
}

export class KindOfJSON {
  x = 1

  toJSON(): { kind: string } {
    return { kind: 'plain' }
  }
}

export interface HasBigint {
  n: bigint
}

export class HoldsHasBigint {
  h: HasBigint = { n: 1n }
}

export class ReturnsBoxedString {
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  toJSON(): String {
    return new String('x')
  }
}

export class ReturnsBoxedNumber {
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  toJSON(): Number {
    return new Number(1)
  }
}

export class ReturnsBoxedBoolean {
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  toJSON(): Boolean {
    return new Boolean(true)
  }
}

export type PartialFrozenDate = Partial<Readonly<Date>>

export class Gamma {
  g = 'g'
}

export class GammaRows extends Array<Gamma> {
  label = 'x'
}

export class StringRows extends Array<string> {
  label = 'a'
}

export class HoldsBuiltinViews {
  set: Pick<Set<string>, 'size'> = new Set(['a'])
  map: Omit<Map<string, number>, 'get'> = new Map([['a', 1]])
  url: Pick<URL, 'href'> & { x: number } = { href: 'h', x: 1 }
  date: PartialFrozenDate = new Date(0)
}

export class StampedDate extends Date {
  label = 'l'
}

export class HoldsStampedView {
  v: Pick<StampedDate, 'label'> = { label: 'x' }
  list: Pick<StampedDate, 'label'>[] = [{ label: 'y' }, new StampedDate(0)]
}

export class Tagger {
  a = 1
  tags = new Set(['t'])
}

export interface ExtendsTagger extends Tagger {
  y: string
}

export interface ExtendsExtendsTagger extends ExtendsTagger {
  z: string
}

export interface ExtendsFrozenTagger extends Readonly<Tagger> {
  w: string
}

export interface ExtendsPickedTagger extends Pick<Tagger, 'a' | 'tags'> {
  extra?: string
}

export type TaggerWithX = Tagger & { x: string }

export interface ExtendsTaggerWithX extends TaggerWithX {
  y: Set<string>
}

export class TaggerJSON {
  tags = new Set(['b'])

  toJSON(): { j: number } {
    return { j: 1 }
  }
}

export interface ExtendsFrozenTaggerJSON extends Readonly<TaggerJSON> {
  y: string
}

export interface ExtendsTaggerJSON extends TaggerJSON {
  y: string
}

export interface ExtendsExtendsTaggerJSON extends ExtendsTaggerJSON {
  z: string
}

export type PickTagger<K extends keyof Tagger> = Pick<Tagger, K>

export type BytesWithTags = Uint8Array & { tags: Set<string> }

export type BytesWithLabel = Uint8Array & { label: string }

export class AlphaModel {
  tags = new Set(['a'])
  gamma = new Gamma()
}

/** Declared with the name a view of `AlphaModel` would get */
export interface Readonly_AlphaModel {
  declared: string
}

/** Declared with the name a view of `AlphaModel` would get */
export interface AlphaModel_View {
  declared: number
}

export const viewsOfBuiltins = {
  expandingViews: os.handler(
    (): {
      frozen: Readonly<Growing<string>>
      plain: Growing<string>
      shape: GrowingShape<string>
    } => ({
      frozen: Object.assign(new Growing('a'), { next: new Growing(['b']) }),
      plain: new Growing('c'),
      shape: { value: 'd', next: { value: ['e'], next: null } },
    }),
  ),
  accessors: os.handler(
    (): {
      frozen: Readonly<AccessorModel>
      picked: Pick<AccessorModel, 'x' | 'y'>
      instance: AccessorModel
      holder: HoldsAccessor
    } => ({
      frozen: new AccessorRuntime(),
      picked: new AccessorRuntime(),
      instance: new AccessorRuntime(),
      holder: new HoldsAccessor(),
    }),
  ),
  declaredToJSON: os.handler(
    (): {
      iface: PointJSON
      alias: PointAlias
      inline: { a: number; toJSON(): string }
      list: PointJSON[]
      instance: PointJSON
      frozen: Readonly<HoldsPointJSON>
      frozenInstance: Readonly<HoldsPointJSON>
      dropping: Readonly<HoldsDroppingShape>
      picked: Pick<DropsJSON, 'a'>
      pickedList: Pick<DropsJSON, 'a'>[]
      holdsPicked: HoldsPickedDrops
      frozenDrops: Readonly<DropsJSON>
      droppedInstance: Readonly<DropsJSON>
    } => ({
      iface: { a: 1, toJSON: () => 'x' },
      alias: { b: 1, toJSON: () => 'x' },
      inline: { a: 1, toJSON: () => 'x' },
      list: [{ a: 1, toJSON: () => 'x' }, new PointInstance()],
      instance: new PointInstance(),
      frozen: { inner: { a: 1, toJSON: () => 'x' } },
      frozenInstance: new HoldsPointJSON(),
      dropping: { d: { a: 2, toJSON: () => undefined } },
      picked: { a: 1 },
      pickedList: [{ a: 1 }, new DropsJSON()],
      holdsPicked: new HoldsPickedDrops(),
      frozenDrops: { a: 1, toJSON: () => undefined },
      droppedInstance: new DropsJSON(),
    }),
  ),
  functionsAndToJSON: os.handler(
    (): {
      cb: TaggedFunction
      n: number
      holder: HoldsTaggedFunction
      list: TaggedFunction[]
      callables: CallableShape[]
      cents: Cents & { toJSON: () => number }
      kind: KindOfJSON & { toJSON: () => number }
      swapped: { toJSON: () => number } & Cents
    } => ({
      cb: Object.assign(() => {}, { tag: 't' }),
      n: 1,
      holder: new HoldsTaggedFunction(),
      list: [Object.assign(() => {}, { tag: 't' })],
      callables: [Object.assign(() => {}, { tag: 'c' })],
      cents: Object.assign(new Cents(1), { toJSON: () => 5 }),
      kind: Object.assign(new KindOfJSON(), { toJSON: () => 6 }),
      swapped: Object.assign(new Cents(1), { toJSON: () => 7 }),
    }),
  ),
  bigintsAndObjects: os.handler(
    (): {
      frozen: Readonly<HoldsHasBigint>
      plain: HasBigint
      list: object
      date: object
      map: object
      boxed: { s: ReturnsBoxedString; n: ReturnsBoxedNumber; b: ReturnsBoxedBoolean }
    } => ({
      frozen: { h: { n: 2n } },
      plain: { n: 3n },
      list: [1, 2],
      date: new Date(0),
      map: new Map([[1, 2]]),
      boxed: {
        s: new ReturnsBoxedString(),
        n: new ReturnsBoxedNumber(),
        b: new ReturnsBoxedBoolean(),
      },
    }),
  ),
  builtinViewsTwo: os.handler(
    (): {
      partialFrozenDate: PartialFrozenDate
      frozenPickedURL: Readonly<Pick<URL, 'href'>>
      partialFrozenBytes: Partial<Readonly<Uint8Array>>
      partialFrozenRows: Partial<Readonly<GammaRows>>
      holder: HoldsBuiltinViews
      url: Pick<URL, 'href'> & { x: number }
      date: Pick<Date, 'getTime'> & { at: Date }
      set: Partial<Set<string>> & { at: Date }
      rows: Partial<StringRows> & { x: string }
      stamped: HoldsStampedView
    } => ({
      partialFrozenDate: new Date(0),
      frozenPickedURL: new URL('http://x/'),
      partialFrozenBytes: new Uint8Array([1, 2]),
      partialFrozenRows: { label: 'x' },
      holder: new HoldsBuiltinViews(),
      url: { href: 'h', x: 1 },
      date: { getTime: () => 1, at: new Date(0) },
      set: { at: new Date(0) },
      rows: { label: 'a', x: 'x' },
      stamped: new HoldsStampedView(),
    }),
  ),
  interfaceViews: os.handler(
    (): {
      extends: ExtendsTagger
      extendsExtends: ExtendsExtendsTagger
      frozen: ExtendsFrozenTagger
      picked: ExtendsPickedTagger
      pickedPlain: ExtendsPickedTagger
      intersection: ExtendsTaggerWithX
      frozenJSON: ExtendsFrozenTaggerJSON
      extendsExtendsJSON: ExtendsExtendsTaggerJSON
      alias: PickTagger<'a' | 'tags'>
      aliasPlain: PickTagger<'tags'>
    } => ({
      extends: Object.assign(new Tagger(), { y: 'y' }),
      extendsExtends: Object.assign(new Tagger(), { y: 'y', z: 'z' }),
      frozen: Object.assign(new Tagger(), { w: 'w' }),
      picked: Object.assign(new Tagger(), { extra: 'e' }),
      pickedPlain: { a: 1, tags: new Set(['p']) },
      intersection: Object.assign(new Tagger(), { x: 'x', y: new Set(['y']) }),
      frozenJSON: { tags: new Set(['b']), y: 'y', toJSON: () => ({ j: 2 }) },
      extendsExtendsJSON: { tags: new Set(['b']), y: 'y', z: 'z', toJSON: () => ({ j: 2 }) },
      alias: new Tagger(),
      aliasPlain: { tags: new Set(['q']) },
    }),
  ),
  typedArrayFields: os.handler(
    (): { tags: BytesWithTags; frozen: Readonly<BytesWithLabel>; label: BytesWithLabel } => ({
      tags: Object.assign(new Uint8Array([1]), { tags: new Set(['a']) }),
      frozen: Object.assign(new Uint8Array([1]), { label: 'x' }),
      label: Object.assign(new Uint8Array([1]), { label: 'x' }),
    }),
  ),
  alphaViews: os.handler(
    (): { frozen: Readonly<AlphaModel>; assigned: AlphaModel & { x: string } } => ({
      frozen: new AlphaModel(),
      assigned: Object.assign(new AlphaModel(), { x: 'x' }),
    }),
  ),
  alphaDeclared: os.handler((): { frozen: Readonly_AlphaModel; view: AlphaModel_View } => ({
    frozen: { declared: 'd' },
    view: { declared: 1 },
  })),
}

/** Inputs of views of built-ins, which a client may send as the built-in or a plain object */
export const viewInputs = {
  partialDate: os.input(type<Partial<Date>>()).handler(() => 1),
  pickedURL: os.input(type<Pick<URL, 'href'>>()).handler(() => 1),
  pickedURLWithX: os.input(type<Pick<URL, 'href'> & { x: number }>()).handler(() => 1),
  partialRowsWithX: os.input(type<Partial<StringRows> & { x: string }>()).handler(() => 1),
}
