import { os, type } from '@orpc/server'

/** Expands with each level, `next` comes first so the walk reaches the cut before `value` */
export interface Unfolding<T> {
  next: Unfolding<T[]> | null
  value: T
}

export class HoldsUnfolding {
  // the walk of `a` is cut at `Unfolding<Set<string>[][][]>`, which `b` uses directly
  a: Unfolding<Set<string>> = { next: null, value: new Set(['a']) }
  b: Unfolding<Set<string>[][][]> = { next: null, value: [[[new Set(['b'])]]] }
}

export class LabelBox<T> {
  constructor(public label: T) {}

  toJSON(): string {
    return 'boxed'
  }
}

export class TagBag<T> {
  tags = new Set<T>()
  n = 1
}

export type PickLabel<T> = Pick<LabelBox<T>, 'label'>
export type PickBagTags<T> = Pick<TagBag<T>, 'tags'>
export type OmitBagNothing<T> = Omit<TagBag<T>, 'nothing'>

export class TagString extends String {}

export class TagNumber extends Number {}

export class ReturnsTagString {
  toJSON(): TagString {
    return new TagString('t')
  }
}

export class ReturnsTagNumber {
  toJSON(): TagNumber {
    return new TagNumber(3)
  }
}

export interface CodedError extends Error {
  code: string
}

export interface MaybeCodedError extends Error {
  code?: number
}

export interface LabeledLink extends Pick<URL, 'href'> {
  label?: string
}

export class Identified {
  id = 1
}

export class WritesJSON {
  v = 'v'

  toJSON(): { j: string } {
    return { j: 'json' }
  }
}

export interface IdThenJSON extends Pick<Identified, 'id'>, Pick<WritesJSON, 'v'> {}

export interface JSONThenId extends Pick<WritesJSON, 'v'>, Pick<Identified, 'id'> {
  extra?: string
}

export type AccountId = string & { __brand: 'AccountId' }

export type Amount = number & { __amount: true }

export type DeepFrozen<T> = { readonly [K in keyof T]: DeepFrozen<T[K]> }

export interface Account {
  id: AccountId
  balance: Amount
  name: string
}

export function accountId(id: string): AccountId {
  return id as AccountId
}

export function amount(value: number): Amount {
  return value as Amount
}

export class TaggedBytes extends Uint8Array {
  s = new Set(['a'])
  d = new Map([['a', 1]])
  n = 1n
}

export class SecretBytes extends Uint8Array {
  private secret = 's'

  reveal(): string {
    return this.secret
  }
}

export type TaggedCallback = (() => number) & { tag: string }

export interface CallableWithTag {
  (): number
  tag: string
}

export enum Priority {
  Low,
  High,
}

export class Prioritized {
  priority: Priority = Priority.Low
}

export class FullName {
  name = 'n'

  get full(): string {
    return `${this.name}!`
  }
}

export class LabeledStamp extends Date {
  label = 'l'
}

export class DeepViewed {
  tags = new Set(['a'])
  get g(): number {
    return 1
  }
}

/** Views of a class nested many times, each a `Readonly` of the last with a field */
export type DeepViewA = Readonly<DeepViewed>
export type DeepViewB = Readonly<DeepViewA> & { f1?: Set<number> }
export type DeepViewC = Readonly<DeepViewB> & { f2?: Set<number> }
export type DeepViewD = Readonly<DeepViewC> & { f3?: Set<number> }
export type DeepViewE = Readonly<DeepViewD> & { f4?: Set<number> }
export type DeepViewF = Readonly<DeepViewE> & { f5?: Set<number> }
export type DeepViewG = Readonly<DeepViewF> & { f6?: Set<number> }
export type DeepViewH = Readonly<DeepViewG> & { f7?: Set<number> }
export type DeepViewI = Readonly<DeepViewH> & { f8?: Set<number> }
export type DeepViewJ = Readonly<DeepViewI> & { f9?: Set<number> }
export type DeepViewK = Readonly<DeepViewJ> & { f10?: Set<number> }
export type DeepViewL = Readonly<DeepViewK> & { f11?: Set<number> }
export type DeepViewM = Readonly<DeepViewL> & { f12?: Set<number> }

export const roundTwentySix = {
  deepViews: os.handler((): DeepViewM => new DeepViewed()),
  holdsUnfolding: os.handler(() => new HoldsUnfolding()),
  genericAliasViews: os.handler(
    (): {
      label: PickLabel<string>
      tags: PickBagTags<number>
      omitted: OmitBagNothing<string>
    } => ({
      label: new LabelBox('x'),
      tags: new TagBag<number>(),
      omitted: new TagBag<string>(),
    }),
  ),
  boxedSubclassJSON: os.handler(() => ({
    s: { v: new ReturnsTagString() },
    n: { v: new ReturnsTagNumber() },
  })),
  errorInterfaces: os.handler((): { coded: CodedError; maybe: MaybeCodedError } => ({
    coded: Object.assign(new Error('boom'), { code: 'E1' }),
    maybe: new Error('boom'),
  })),
  linkInterface: os.handler((): { instance: LabeledLink; plain: LabeledLink } => ({
    instance: new URL('http://x/'),
    plain: { href: 'h', label: 'l' },
  })),
  twoClassViews: os.handler((): { first: IdThenJSON; second: JSONThenId } => ({
    first: Object.assign(new WritesJSON(), { id: 1 }),
    second: Object.assign(new WritesJSON(), { id: 1 }),
  })),
  brandedMapped: os.handler(
    (): {
      id: Readonly<AccountId>
      partial: Partial<AccountId>
      amount: Readonly<Amount>
      flag: Readonly<boolean & { __flag: 1 }>
      account: DeepFrozen<Account>
    } => ({
      id: accountId('a1'),
      partial: accountId('a2'),
      amount: amount(5),
      flag: true as boolean & { __flag: 1 },
      account: { id: accountId('a3'), balance: amount(6), name: 'n' },
    }),
  ),
  typedArrayViews: os.handler(
    (): {
      set: Pick<TaggedBytes, 's'>
      map: Pick<TaggedBytes, 'd'>
      bigint: { v: Pick<TaggedBytes, 'n'> }
      frozen: Readonly<SecretBytes>
      partial: Partial<SecretBytes>
    } => ({
      set: { s: new Set(['a']) },
      map: { d: new Map([['a', 1]]) },
      bigint: { v: { n: 1n } },
      frozen: new SecretBytes([0]),
      partial: new SecretBytes([1]),
    }),
  ),
  // an expanding generic cuts this conversion, the enum next to it keeps its name
  prioritizedView: os.handler((): { v: Readonly<Prioritized>; list: Unfolding<number>[] } => ({
    v: new Prioritized(),
    list: [],
  })),
  priorities: os.handler((): Priority[] => [Priority.High]),
}

/** Functions are written as nothing, the response has no body */
export const callables = {
  tagged: os.handler((): TaggedCallback => Object.assign(() => 1, { tag: 't' })),
  taggedOrNumber: os.handler((): TaggedCallback | number => 1),
  callable: os.handler((): CallableWithTag => Object.assign(() => 1, { tag: 't' })),
}

/** Inputs a client may send as an instance or a plain object */
export const instanceInputs = {
  frozenFullName: os.input(type<Readonly<FullName>>()).handler(() => 1),
  fullName: os.input(type<FullName>()).handler(() => 1),
  pickedStamp: os.input(type<Pick<LabeledStamp, 'label'>>()).handler(() => 1),
  link: os.input(type<LabeledLink>()).handler(() => 1),
  error: os.input(type<MaybeCodedError>()).handler(() => 1),
  branded: os.input(type<{ id: Readonly<AccountId> }>()).handler(() => 1),
}
