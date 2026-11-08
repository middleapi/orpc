export type MidRest = [string, ...number[], boolean]
export type LeadRest = [...string[], number]
export type OptUndef = [string, (number | undefined)?]
export type OptPlain = [string, number?]
export interface Named { x: number }
export type ArrNamedOpt = (Named | undefined)[]
export interface DualIndex { [k: string]: Named | string; [k: number]: Named }
export interface NumIndexOnly { [k: number]: string }
export interface SymIdx { [k: symbol]: Named; a: string }
export type AnonRec = { a: { next: AnonRec2 } }
export type AnonRec2 = AnonRec
export interface MyArr extends Array<string> { extra: number }
export type BrandDate = Date & { __brand: 'd' }
export interface PropUnknown { a: unknown; b: any; c: void; d: string | void }
export type RootVoidUnion = string | void
export type Tpl = `a${string}`
export type Gen<T> = { value: T }
export interface UsesGen { a: Gen<string>; b: Gen<number> }
