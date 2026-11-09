// @ts-expect-error the module does not exist
import type { Missing } from '@/missing'
import type { User } from '@/shared/user'

const key = 'abc'

export type RestInMiddle = [string, ...number[], boolean]
export type RestFirst = [...string[], number]
export type OptionalUndefinedElement = [string, (number | undefined)?]

export interface OptionalNonSerializable {
  cb?: () => void
  s?: symbol
  n: number
}

export class WithMethod {
  a = 1
  method(): void {}
}
export type PartialWithMethod = Partial<WithMethod>

export interface WithMissing {
  missing: Missing
}
export interface HoldsMissing {
  w: WithMissing
}

export type Expand<T> = { value: T; next?: Expand<T[]> }
export type Expanded = Expand<string>

export interface NullableInteger {
  /** @type integer */
  age: number | null
  /** @type integer */
  user: User
}

export interface SpecialKeys {
  '__typename': 'User'
  '__@odd': number
  '#hash': string
}

export interface SymbolIndex {
  [k: symbol]: User
  a: string
}

export type BrandedDate = Date & { __brand: 'CreatedAt' }

export enum Computed {
  A = key.length,
  B = A * 2,
}
