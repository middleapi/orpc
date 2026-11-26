import { os, type } from '@orpc/server'

import type { LooseDeep } from './deep-partial-brands'

declare const usym: unique symbol
declare const rsym: unique symbol
declare const nsym: unique symbol

/** Generic brands keyed by `T` and a literal, or nesting the mapped type over `T` */
export type UnionKeyBrand<T extends string> = { [usym]: { [k in T | 'extra']: true } }
export type RecordUnionBrand<T extends string> = { [rsym]: Record<T | 'extra', true> }
export type NestedBrand<T extends string> = { [nsym]: { inner: { [k in T]: true } } }

export type UnionKeyNum = number & UnionKeyBrand<'u'>
export type RecordUnionNum = number & RecordUnionBrand<'r'>
export type NestedNum = number & NestedBrand<'n'>

/** Sent by an instance, also of a deep view of it, as its `toJSON` */
export class JsonDicts {
  counts: { [key in string]: number } = { a: 1 }
  none: { [key in never]: number } = {}

  toJSON(): string {
    return 'dicts'
  }
}

export const nestedBrands = {
  looseUnionKeyNum: os.handler((): LooseDeep<UnionKeyNum> => 5 as UnionKeyNum),
  looseRecordUnionNum: os.handler((): LooseDeep<RecordUnionNum> => 5 as RecordUnionNum),
  looseNestedNum: os.handler((): LooseDeep<NestedNum> => 5 as NestedNum),
  mappedUnionKeyNum: os.handler(
    (): { [K in keyof UnionKeyNum]: UnionKeyNum[K] } => 5 as UnionKeyNum,
  ),
  mappedRecordUnionNum: os.handler(
    (): { [K in keyof RecordUnionNum]: RecordUnionNum[K] } => 5 as RecordUnionNum,
  ),
  mappedNestedNum: os.handler((): { [K in keyof NestedNum]: NestedNum[K] } => 5 as NestedNum),
  looseUnionKeyNums: os.handler((): LooseDeep<UnionKeyNum[]> => [5 as UnionKeyNum]),
  looseNestedHolder: os.handler((): LooseDeep<{ v: NestedNum }> => ({ v: 5 as NestedNum })),
  looseJsonDicts: os.handler((): LooseDeep<JsonDicts> => new JsonDicts()),
}

export const nestedBrandsInputs = {
  looseUnionKeyNum: os.input(type<LooseDeep<UnionKeyNum>>()).handler(() => 1),
  looseRecordUnionNum: os.input(type<LooseDeep<RecordUnionNum>>()).handler(() => 1),
  looseNestedHolder: os.input(type<LooseDeep<{ v: NestedNum }>>()).handler(() => 1),
  looseJsonDicts: os.input(type<LooseDeep<JsonDicts>>()).handler(() => 1),
  looseJsonDictsHolder: os.input(type<{ d: LooseDeep<JsonDicts> }>()).handler(() => 1),
}
