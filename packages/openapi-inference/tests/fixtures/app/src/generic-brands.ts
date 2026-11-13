import { os, type } from '@orpc/server'

import type { LooseDeep } from './deep-partial-brands'

declare const tsym: unique symbol
declare const ksym: unique symbol
declare const usym: unique symbol
declare const rsym: unique symbol

/** Generic brands keyed by a template literal over, keys of, a string mapping of or a record over `T` */
export type TplBrand<T extends string> = { [tsym]: { [k in `b-${T}`]: true } }
export type KeyAndBrand<T> = { [ksym]: { [k in keyof T & string]: true } }
export type UpperBrand<T extends string> = { [usym]: { [k in Uppercase<T>]: true } }
export type RecordBrand<T extends string> = { [rsym]: Record<T, true> }

export type TplNum = number & TplBrand<'n'>
export type KeyNum = number & KeyAndBrand<{ a: 1 }>
export type UpperNum = number & UpperBrand<'u'>
export type RecordNum = number & RecordBrand<'r'>

export class BrandedLedger {
  tpl = 1 as TplNum
  key = 2 as KeyNum
  upper = 3 as UpperNum
  record = 4 as RecordNum
}

export const brandedLedger = (): LooseDeep<BrandedLedger> => new BrandedLedger()

export const genericBrands = {
  looseTplNum: os.handler((): LooseDeep<TplNum> => 5 as TplNum),
  looseKeyNum: os.handler((): LooseDeep<KeyNum> => 5 as KeyNum),
  looseUpperNum: os.handler((): LooseDeep<UpperNum> => 5 as UpperNum),
  looseRecordNum: os.handler((): LooseDeep<RecordNum> => 5 as RecordNum),
  mappedTplNum: os.handler((): { [K in keyof TplNum]: TplNum[K] } => 5 as TplNum),
  mappedKeyNum: os.handler((): { [K in keyof KeyNum]: KeyNum[K] } => 5 as KeyNum),
  mappedUpperNum: os.handler((): { [K in keyof UpperNum]: UpperNum[K] } => 5 as UpperNum),
  mappedRecordNum: os.handler((): { [K in keyof RecordNum]: RecordNum[K] } => 5 as RecordNum),
  looseTplNums: os.handler((): LooseDeep<TplNum[]> => [5 as TplNum]),
  looseUpperHolder: os.handler((): LooseDeep<{ v: UpperNum }> => ({ v: 5 as UpperNum })),
  looseBrandedLedger: os.handler(brandedLedger),
}

export const genericBrandsInputs = {
  looseBrandedLedger: os.input(type<LooseDeep<BrandedLedger>>()).handler(() => 1),
  looseKeyNum: os.input(type<LooseDeep<KeyNum>>()).handler(() => 1),
}
