import { os, type } from '@orpc/server'
import type { PartialDeep, Simplify } from 'type-fest'

import type {
  DeepPartialIf,
  DeepPartialOf,
  DeepReadonlyIf,
  DeepRO,
  WithCallback,
} from './deep-views'
import { Holder } from './deep-views'

/** An error with a code */
export interface CodedFailure extends Error {
  code: number
}

/** An error with a code and an extra field */
export type CodedFailureExtra = CodedFailure & { extra: 1 }

export interface CodeFailure extends Error {
  code: string
}

export interface MessageFailure extends Error {
  message: string
}

export interface MaybeExtra {
  extra?: string
}

/** Values or read-only views of them */
export type OrFrozen<T> = { [K in keyof T]: T[K] | Readonly<T[K]> }
/** Deep views of values, or the values */
export type DeepOrSame<T> = { readonly [K in keyof T]: DeepOrSame<T[K]> | T[K] }

export class WritesW {
  v = 1

  toJSON(): { w: string } {
    return { w: 'x' }
  }
}

export class HoldsWritesW {
  j = new WritesW()
  tags = new Set(['a'])
}

/** Sealed all the way down */
export type DeepSealed<T> = { readonly [K in keyof T]: DeepSealed<T[K]> }

export class RingSideA {
  b: RingSideB | null = null
  tags = new Set<string>()
}

export class RingSideB {
  a: RingSideA | null = null
}

export type NumBrand = number & { __num: 'N' }
export type StrBrand = string & { __str: 'S' }

export interface WithBrands {
  id: StrBrand
  n: NumBrand
}

/** Mutable all the way down, keeping functions */
export type DeepMutable<T> = T extends Function
  ? T
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T

/** Each value, as type-fest's `Simplify` */
export type SimpleOf<T> = { [K in keyof T]: T[K] } & {}

const num = (n: number) => n as NumBrand
const str = (s: string) => s as StrBrand

export class SetAndURL {
  s = new Set([1])
  u = new URL('http://x/')
}

export class SetAndParams {
  s = new Set([1])
  p = new URLSearchParams('a=1')
}

export type Callback = () => void

export class FnBox<T> {
  constructor(public value: T) {}
}

export class WithArrow {
  n = 1
  f = (): number => 1
}

export class ParamTags {
  tags = new Set(['x'])

  constructor(public a = 1) {}
}

export class OnlyParamTags {
  constructor(public tags = new Set(['a'])) {}
}

export class ParamMoney {
  constructor(public amount = 1) {}

  toJSON(): { amt: number; cur: string } {
    return { amt: this.amount, cur: 'USD' }
  }
}

export const TagsExpression = class {
  tags = new Set(['y'])
}

export type TagsExpressionInstance = InstanceType<typeof TagsExpression>

const failure = <T extends object>(fields: T) => Object.assign(new Error('boom'), fields)

export const viewIntersections = {
  // members an interface inherits from `Error` stay optional in an intersection
  errorIntersections: os.handler(
    (): {
      e: CodedFailureExtra
      frozen: Readonly<CodedFailure> & { extra: 1 }
      code: CodeFailure & MaybeExtra
      msg: MessageFailure & MaybeExtra
      frozenCode: Readonly<CodeFailure & MaybeExtra>
      list: Array<CodeFailure & MaybeExtra>
    } => ({
      e: failure({ code: 1, extra: 1 as const }),
      frozen: failure({ code: 1, extra: 1 as const }),
      code: failure({ code: 'c' }),
      msg: new Error('m'),
      frozenCode: failure({ code: 'c' }),
      list: [failure({ code: 'c' })],
    }),
  ),
  errorIntersectionRoot: os.handler((): CodeFailure & MaybeExtra => failure({ code: 'c' })),
  // mapped types widening each value with views of it are views
  widenedViews: os.handler((): { frozen: OrFrozen<Holder>; deep: DeepOrSame<HoldsWritesW> } => ({
    frozen: new Holder(),
    deep: new HoldsWritesW(),
  })),
  // deep views of classes referring to each other
  ringSideA: os.handler((): DeepSealed<RingSideA> => new RingSideA()),
  ringSideB: os.handler((): DeepSealed<RingSideB> => new RingSideB()),
  // conditional deep mapped types over branded primitives are the primitives
  brandedConditional: os.handler(
    (): {
      deep: DeepReadonlyIf<WithBrands>
      partial: DeepPartialIf<WithBrands>
      mutable: DeepMutable<WithBrands>
    } => ({
      deep: { id: str('i'), n: num(1) },
      partial: { id: str('i'), n: num(1) },
      mutable: { id: str('i'), n: num(1) },
    }),
  ),
  brandedConditionalRoot: os.handler((): DeepReadonlyIf<NumBrand> => num(1)),
  simplified: os.handler(
    (): { n: Simplify<NumBrand>; s: Simplify<StrBrand>; local: SimpleOf<NumBrand> } => ({
      n: num(1),
      s: str('s'),
      local: num(2),
    }),
  ),
  simplifiedRoot: os.handler((): Simplify<NumBrand> => num(1)),
  // conditional deep mapped types over intersections with a class or a built-in
  conditionalIntersections: os.handler(
    (): {
      holder: DeepReadonlyIf<Holder & MaybeExtra>
      date: DeepReadonlyIf<Date & MaybeExtra>
      partialDate: DeepPartialIf<Date & MaybeExtra>
      url: DeepReadonlyIf<URL & MaybeExtra>
      set: DeepReadonlyIf<Set<string> & MaybeExtra>
    } => ({
      holder: new Holder(),
      date: new Date(3),
      partialDate: new Date(3),
      url: new URL('http://x/'),
      set: new Set(['a']),
    }),
  ),
  conditionalIntersectionRoot: os.handler((): DeepReadonlyIf<Holder & MaybeExtra> => new Holder()),
  // classes declaring fields as constructor parameters, or by a class expression
  conditionalParameterIntersections: os.handler(
    (): {
      params: DeepReadonlyIf<ParamTags & MaybeExtra>
      only: DeepReadonlyIf<OnlyParamTags>
      onlyExtra: DeepReadonlyIf<OnlyParamTags & MaybeExtra>
      money: DeepReadonlyIf<ParamMoney & MaybeExtra>
      box: DeepReadonlyIf<FnBox<Set<string>> & MaybeExtra>
      expression: DeepReadonlyIf<TagsExpressionInstance & MaybeExtra>
      n: 1
    } => ({
      params: new ParamTags(),
      only: new OnlyParamTags(),
      onlyExtra: new OnlyParamTags(),
      money: new ParamMoney(),
      box: new FnBox(new Set(['a'])),
      expression: new TagsExpression(),
      n: 1,
    }),
  ),
  conditionalParameterRoot: os.handler(
    (): DeepReadonlyIf<ParamTags & MaybeExtra> => new ParamTags(),
  ),
  conditionalParameterOnlyRoot: os.handler(
    (): DeepReadonlyIf<OnlyParamTags> => new OnlyParamTags(),
  ),
  conditionalMoneyRoot: os.handler((): DeepReadonlyIf<ParamMoney & MaybeExtra> => new ParamMoney()),
  conditionalExpressionRoot: os.handler(
    (): DeepReadonlyIf<TagsExpressionInstance & MaybeExtra> => new TagsExpression(),
  ),
  // type-fest maps the `URLSearchParams` of a `URL` to a `ReadonlyMap`, which still holds it
  typeFestURLs: os.handler(
    (): { url: PartialDeep<SetAndURL>; params: PartialDeep<SetAndParams> } => ({
      url: new SetAndURL(),
      params: new SetAndParams(),
    }),
  ),
  // views of views of a function may hold the function
  nestedFunctionViews: os.handler(
    (): {
      deep: DeepRO<DeepReadonlyIf<Callback>>
      frozen: Readonly<DeepMutable<Readonly<Callback>>>
      partial: DeepPartialOf<DeepMutable<Readonly<Callback>>>
      n: 1
    } => ({ deep: () => {}, frozen: () => {}, partial: () => {}, n: 1 }),
  ),
  boxedFunctionView: os.handler(
    (): FnBox<DeepRO<DeepMutable<Required<Callback>>>> => new FnBox(() => {}),
  ),
}

/** Inputs of views a client may send */
export const viewIntersectionsInputs = {
  errorIntersection: os.input(type<{ e: CodedFailureExtra }>()).handler(() => 1),
  brandedConditional: os.input(type<DeepReadonlyIf<{ id: StrBrand }>>()).handler(() => 1),
  simplified: os.input(type<{ n: Simplify<NumBrand> }>()).handler(() => 1),
  conditionalDate: os.input(type<{ at: DeepReadonlyIf<Date & MaybeExtra> }>()).handler(() => 1),
  // a client drops the functions views of them may hold
  frozenCallback: os.input(type<{ cb: Readonly<() => void>; n: number }>()).handler(() => 1),
  deepCallback: os.input(type<DeepRO<WithCallback>>()).handler(() => 1),
  conditionalCallback: os.input(type<DeepReadonlyIf<WithCallback>>()).handler(() => 1),
  conditionalCallbackField: os
    .input(type<{ cb: DeepReadonlyIf<() => void>; n: number }>())
    .handler(() => 1),
  conditionalArrow: os.input(type<DeepReadonlyIf<WithArrow>>()).handler(() => 1),
}
