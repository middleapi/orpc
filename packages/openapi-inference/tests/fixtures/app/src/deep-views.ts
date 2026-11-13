import { os, type } from '@orpc/server'
import type { PartialDeep, ReadonlyDeep } from 'type-fest'

import type { AccountId, Unfolding } from './class-views'

/** Read-only all the way down */
export type DeepRO<T> = { readonly [K in keyof T]: DeepRO<T[K]> }
/** Optional all the way down */
export type DeepPartialOf<T> = { [K in keyof T]?: DeepPartialOf<T[K]> }

/** A DAG of models that all reach an expanding generic */
export interface LevelA {
  a: LevelB
  b: LevelB
}
export interface LevelB {
  a: LevelC
  b: LevelC
}
export interface LevelC {
  a: LevelD
  b: LevelD
}
export interface LevelD {
  a: LevelE
  b: LevelE
}
export interface LevelE {
  a: LevelF
  b: LevelF
}
export interface LevelF {
  a: LevelG
  b: LevelG
}
export interface LevelG {
  a: LevelH
  b: LevelH
}
export interface LevelH {
  a: LevelI
  b: LevelI
}
export interface LevelI {
  a: LevelJ
  b: LevelJ
}
export interface LevelJ {
  a: LevelK
  b: LevelK
}
export interface LevelK {
  a: LevelL
  b: LevelL
}
export interface LevelL {
  a: LevelM
  b: LevelM
}
export interface LevelM {
  a: LevelN
  b: LevelN
}
export interface LevelN {
  a: LevelO
  b: LevelO
}
export interface LevelO {
  u: Unfolding<number>
}

export class HoldsLevels {
  l: LevelA | null = null
}

export interface FnWithJSON {
  (): number
  toJSON(): string
}

export class StaticJSON {
  label = 'l'

  static toJSON(): string {
    return 'ctor'
  }
}

export interface SetError extends Error {
  tags: Set<string>
}

export interface MapError extends Error {
  m: Map<string, number>
}

export interface MetaError extends Error {
  meta: { tags: Set<string> }
}

export class Identity {
  id = 1
}

export class StampedDate extends Date {
  label = 'l'
}

export class TagSet extends Set<string> {
  label = 'l'
}

export interface StampedLike extends StampedDate {}

export interface IdTags extends Pick<Identity, 'id'>, Pick<TagSet, 'label'> {}
export interface TagsId extends Pick<TagSet, 'label'>, Pick<Identity, 'id'> {
  extra?: string
}
export interface IdStamp extends Pick<Identity, 'id'>, Pick<StampedDate, 'label'> {}
export interface StampId extends Pick<StampedDate, 'label'>, Pick<Identity, 'id'> {}
export type InterStamp = Pick<Identity, 'id'> & Pick<StampedDate, 'label'>

export type Mask<T> = { [K in keyof T]?: true }

export class Holder {
  tags = new Set(['a'])
  map = new Map([['k', 1]])
  n = 1
}

export class OuterHolder {
  inner = new Holder()
  tags = new Set(['b'])
}

export class WritesJ {
  v = 'v'

  toJSON(): { j: string } {
    return { j: 'j' }
  }
}

export class Getters {
  fb?: number

  get gd(): RegExp {
    return /a/u
  }
}

export interface MsgError extends Error {
  message: string
}

export interface NameError extends Error {
  name: string
}

export interface StackError extends Error {
  stack: string
}

export interface LiteralError extends Error {
  message: 'boom'
  name: 'AppError'
}

export interface ViaMsgError extends MsgError {
  code: string
}

export class AppErr extends Error {}

/** Redeclares the message of a subclass of `Error` */
export interface AppErrMsg extends AppErr {
  message: string
}

/** Redeclares the message of `TypeError` */
export interface TypeErrMsg extends TypeError {
  message: string
}

export interface SizedParams extends URLSearchParams {
  size: number
}

/** Redeclares the length of a typed array */
export interface ByteLen extends Uint8Array {
  byteLength: number
}

export interface ReLast extends RegExp {
  lastIndex: number
}

export interface AbortMsg extends AbortController {
  signal: AbortSignal
}

export interface SizedSet extends Pick<Set<string>, 'size'> {}

export interface LinkView extends Pick<URL, 'href'> {
  label?: string
}

export class OtherX {
  x = 1
}

export interface LinkAndX extends Pick<URL, 'href'>, Pick<OtherX, 'x'> {}

export interface CodeError extends Error {
  code?: number
}

export class StrBox extends String {
  a = 1
}

/** Labeled bytes, or a plain object */
export interface TypedLabel extends Pick<Uint8Array, 'length'> {
  label: string
}

export interface OptionalMaps {
  a?: Map<string, boolean>
  b: Map<string, boolean>
}

export interface OptionalDates {
  a?: { x: Date }
  b: { x: Date }
}

/** Frozen all the way down */
export type DeepFrozen<T> = { readonly [K in keyof T]: DeepFrozen<T[K]> }

/** Grows its type argument at each level */
export class GrowingNest<T> {
  next: GrowingNest<T[]> | null = null

  constructor(public value: T) {}
}

/** A function JSON writes by its `toJSON` when it has one, else as nothing */
export type FnMaybeJSON = (() => number) & { toJSON?: () => string; tag: string }

/** Bytes, or a plain object holding their buffer */
export interface BufView extends Pick<Uint8Array, 'buffer'> {
  label: string
}

/** Read-only all the way down, through a conditional type */
export type DeepReadonlyIf<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonlyIf<T[K]> }
  : T
/** Optional all the way down, through a conditional type */
export type DeepPartialIf<T> = T extends object ? { [K in keyof T]?: DeepPartialIf<T[K]> } : T

export class WritesString {
  a = 1

  toJSON(): string {
    return 'j'
  }
}

const withTag = (toJSON?: () => string): FnMaybeJSON =>
  Object.assign(() => 1, toJSON ? { tag: 't', toJSON } : { tag: 't' })

/** Callable, with a field */
export interface FnProps {
  (): number
  tag: string
}

/** A read-only view of a function with a field */
export type FnPropsView = Readonly<FnProps>

/** A function and a class */
export interface FnAndHolder {
  f: FnMaybeJSON
  h: Holder
}

/** A function */
export interface HoldsFn {
  f: FnMaybeJSON
}

/** A callback and a number */
export interface WithCallback {
  cb: () => void
  n: number
}

const withProps = (): FnProps => Object.assign(() => 1, { tag: 't' })

export const deepMappedViews = {
  holdsLevels: os.handler(() => new HoldsLevels()),
  errorFields: os.handler((): { set: SetError; map: MapError; meta: MetaError } => ({
    set: Object.assign(new Error('x'), { tags: new Set(['a']) }),
    map: Object.assign(new Error('x'), { m: new Map([['a', 1]]) }),
    meta: Object.assign(new Error('x'), { meta: { tags: new Set(['a']) } }),
  })),
  classOrder: os.handler((): { idTags: IdTags; tagsId: TagsId } => ({
    idTags: Object.assign(new TagSet(['x']), { id: 1 }),
    tagsId: Object.assign(new TagSet(['x']), { id: 1 }),
  })),
  maskedBrand: os.handler((): { m: Mask<AccountId> } => ({ m: {} })),
  mask: os.handler((): Mask<AccountId> => ({})),
  deepClassViews: os.handler(
    (): {
      holder: DeepRO<Holder>
      outer: DeepRO<OuterHolder>
      json: DeepRO<WritesJ>
      readonlyDeep: ReadonlyDeep<Holder>
      partialDeep: PartialDeep<Holder>
      deepPartial: DeepPartialOf<Holder>
      record: Record<string, DeepRO<Holder>>
    } => ({
      holder: new Holder(),
      outer: new OuterHolder(),
      json: new WritesJ(),
      readonlyDeep: new Holder(),
      partialDeep: new Holder(),
      deepPartial: new Holder(),
      record: { a: new Holder() },
    }),
  ),
  deepJSON: os.handler((): DeepRO<WritesJ> => new WritesJ()),
  redeclaredErrors: os.handler(
    (): {
      msg: MsgError
      name: NameError
      stack: StackError
      literal: LiteralError
      via: ViaMsgError
      app: AppErrMsg
      typeErr: TypeErrMsg
      params: SizedParams
      bytes: ByteLen
      re: ReLast
      abort: AbortMsg
    } => ({
      msg: new Error('m'),
      name: new Error('m'),
      stack: Object.assign(new Error('m'), { stack: 's' }),
      literal: Object.assign(new Error('boom') as Error & { message: 'boom' }, {
        name: 'AppError' as const,
      }),
      via: Object.assign(new Error('m'), { code: 'c' }),
      app: new AppErr('m'),
      typeErr: new TypeError('m'),
      params: new URLSearchParams('a=1'),
      bytes: new Uint8Array([1, 2]),
      re: /a/u,
      abort: new AbortController(),
    }),
  ),
  deepBuiltins: os.handler(
    (): {
      re: DeepRO<RegExp>
      bytes: DeepRO<Uint8Array>
      partialBytes: DeepPartialOf<Uint8Array>
      params: DeepRO<URLSearchParams>
      sized: DeepRO<SizedSet>
    } => ({
      re: /a/u,
      bytes: new Uint8Array([1]),
      partialBytes: new Uint8Array([1]),
      params: new URLSearchParams('a=1'),
      sized: new Set(['a']),
    }),
  ),
  builtinInterfaceViews: os.handler(
    (): {
      readonlyLink: Readonly<LinkView>
      pickedLink: Pick<LinkView, 'href'>
      readonlyLinkX: Readonly<LinkAndX>
      partialSized: Partial<SizedSet>
      readonlyCode: Readonly<CodeError>
      pickedCode: Pick<CodeError, 'message' | 'code'>
      pickedStamp: Pick<StampedLike, 'label'>
    } => ({
      readonlyLink: new URL('http://x/'),
      pickedLink: new URL('http://x/'),
      readonlyLinkX: Object.assign(new URL('http://x/'), { x: 1 }),
      partialSized: new Set(['a']),
      readonlyCode: new Error('m'),
      pickedCode: new Error('m'),
      pickedStamp: new StampedDate(0),
    }),
  ),
  partialStr: os.handler((): Partial<StrBox> => ({})),
  typedLabel: os.handler((): TypedLabel => Object.assign(new Uint8Array([1]), { label: 'l' })),
  optionalDeep: os.handler((): { maps: DeepRO<OptionalMaps>; dates: DeepRO<OptionalDates> } => ({
    maps: { b: new Map() },
    dates: { b: { x: new Date(0) } },
  })),
  // expanding generics under deep mapped types
  deepUnfolding: os.handler((): DeepFrozen<Unfolding<number>> => ({
    value: 1,
    next: { value: [2], next: { value: [[3]], next: { value: [[[4]]], next: null } } },
  })),
  readonlyDeepUnfolding: os.handler((): ReadonlyDeep<Unfolding<number>> => ({
    value: 1,
    next: { value: [2], next: { value: [[3]], next: { value: [[[4]]], next: null } } },
  })),
  partialDeepUnfolding: os.handler((): PartialDeep<Unfolding<number>> => ({
    value: 1,
    next: { next: { value: [[3]] } },
  })),
  deepNest: os.handler((): DeepPartialOf<GrowingNest<number>> => {
    const nest = new GrowingNest(1)
    nest.next = new GrowingNest([2])
    nest.next.next = new GrowingNest([[3]])
    return nest
  }),
  // a function without its optional `toJSON` is dropped
  maybeFunctionJSON: os.handler((): { f: FnMaybeJSON; g: FnMaybeJSON; list: FnMaybeJSON[] } => ({
    f: withTag(),
    g: withTag(() => 'fn'),
    list: [withTag(), withTag(() => 'fn')],
  })),
  maybeFunctionJSONRoot: os.handler((): FnMaybeJSON => withTag(() => 'fn')),
  // an interface over a view of a typed array holds bytes or a plain object
  bufView: os.handler((): { plain: BufView; bytes: BufView } => ({
    plain: { buffer: new ArrayBuffer(1), label: 'l' },
    bytes: Object.assign(new Uint8Array([1]), { label: 'l' }),
  })),
  // conditional deep mapped types over a class are views of it
  conditionalDeepViews: os.handler(
    (): {
      json: DeepReadonlyIf<WritesString>
      plainJSON: DeepReadonlyIf<WritesString>
      partial: DeepPartialIf<Holder>
      partialPlain: DeepPartialIf<Holder>
    } => ({
      json: new WritesString(),
      plainJSON: { a: 1, toJSON: {} },
      partial: new Holder(),
      partialPlain: { tags: new Set(['a']), map: new Map([['k', 1]]) },
    }),
  ),
  conditionalDeepJSON: os.handler((): DeepReadonlyIf<WritesString> => new WritesString()),
  // a mapped view of a function may hold the function, which JSON drops
  functionViews: os.handler(
    (): {
      deep: DeepRO<WithCallback>
      conditional: DeepReadonlyIf<WithCallback>
      readonlyFn: Readonly<() => void>
      deepMaybe: DeepRO<FnAndHolder>
      readonlyProps: Readonly<FnProps>
      partialProps: Partial<FnProps>
      pickedProps: Pick<FnProps, 'tag'>
      readonlyMaybe: Readonly<FnMaybeJSON>
      list: Readonly<FnProps>[]
    } => ({
      deep: { cb: () => {}, n: 1 },
      conditional: { cb: () => {}, n: 1 },
      readonlyFn: () => {},
      deepMaybe: { f: withTag(), h: new Holder() },
      readonlyProps: withProps(),
      partialProps: withProps(),
      pickedProps: withProps(),
      readonlyMaybe: withTag(),
      list: [withProps(), { tag: 'plain' }],
    }),
  ),
  // or a plain object of its fields, or a function with its `toJSON`
  plainFunctionViews: os.handler(
    (): {
      deepMaybe: DeepRO<HoldsFn>
      readonlyProps: Readonly<FnProps>
      partialProps: Partial<FnProps>
      readonlyMaybe: Readonly<FnMaybeJSON>
      withJSON: Readonly<FnMaybeJSON>
    } => ({
      deepMaybe: { f: withTag(() => 'fn') },
      readonlyProps: { tag: 'plain' },
      partialProps: {},
      readonlyMaybe: { tag: 'plain', toJSON: () => 'skipped' },
      withJSON: withTag(() => 'fn'),
    }),
  ),
  functionViewRoot: os.handler((): DeepRO<WithCallback> => ({ cb: () => {}, n: 1 })),
  // a function there is written as nothing
  functionRoot: os.handler((): Readonly<FnProps> => ({ tag: 'plain' })),
  // `JSON.stringify` writes what `toJSON` of a function returns
  functionJSON: os.handler((): FnWithJSON => Object.assign(() => 1, { toJSON: () => 'fn' })),
  constructorJSON: os.handler((): typeof StaticJSON => StaticJSON),
  functionJSONField: os.handler((): { f: FnWithJSON; list: FnWithJSON[] } => ({
    f: Object.assign(() => 1, { toJSON: () => 'fn' }),
    list: [Object.assign(() => 1, { toJSON: () => 'fn' })],
  })),
}

/** Inputs a client may send as an instance or a plain object */
export const viewedInputs = {
  idStamp: os.input(type<IdStamp>()).handler(() => 1),
  interStamp: os.input(type<InterStamp>()).handler(() => 1),
  stampId: os.input(type<StampId>()).handler(() => 1),
  deepGetters: os.input(type<DeepRO<Getters>>()).handler(() => 1),
  msg: os.input(type<MsgError>()).handler(() => 1),
  via: os.input(type<{ e: ViaMsgError }>()).handler(() => 1),
  params: os.input(type<{ p: SizedParams }>()).handler(() => 1),
  deepRe: os.input(type<{ r: DeepRO<RegExp> }>()).handler(() => 1),
  dateOrSized: os.input(type<Date | DeepRO<SizedSet>>()).handler(() => 1),
  readonlyLink: os.input(type<Readonly<LinkView>>()).handler(() => 1),
  pickedLink: os.input(type<Pick<LinkView, 'href'>>()).handler(() => 1),
  partialSized: os.input(type<Partial<SizedSet>>()).handler(() => 1),
  partialStr: os.input(type<Partial<StrBox>>()).handler(() => 1),
  bufView: os.input(type<BufView>()).handler(() => 1),
}
