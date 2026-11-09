import type {
  CamelCasedPropertiesDeep,
  Jsonify,
  ReadonlyDeep,
  RequireAtLeastOne,
  RequireExactlyOne,
  Writable,
} from 'type-fest'

import type { User } from '@/shared/user'

export enum Role {
  Admin = 'admin',
  Member = 'member',
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }
export type UserResult = Result<User>
export type RoleRecord = Record<Role, boolean>
export type PartialRoleRecord = Partial<Record<Role, number>>
export type NumberKeys = Record<number, string>
export type Camel = CamelCasedPropertiesDeep<{
  user_name: string
  nested_obj: { first_value: number }
}>
export type Jsonified = Jsonify<{ date: Date; fn: () => void; n: number; u?: undefined }>
export type DeepRO = ReadonlyDeep<{ a: { b: string[] } }>
export type AtLeastOne = RequireAtLeastOne<{ a?: string; b?: number }, 'a' | 'b'>
export type ExactlyOne = RequireExactlyOne<{ a: string; b: number }, 'a' | 'b'>
export type Writ = Writable<{ readonly a: string }>
export type Overloaded = { (a: string): string; (a: number): number }
export type WithOverload = { name: string; call: Overloaded }
export type DeepGeneric = Result<Array<Result<{ id: number }, Error>>>
export type UnionOfArrays = string[] | number[]
export type OptionalTuple = [a?: string, b?: number]
export type NestedNull = { a: { b: string | null } | null }
export type Combined = User & { role: Role }
export type Keys = `${Role}-key`
export type InterfaceInUnion = User | null | 'anonymous'
