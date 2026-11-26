export interface Box<T> {
  v: T
}

export interface Model {
  id: number
}

/** Each value, read-only, deeply */
type ConditionalDeep<T> = T extends object ? { readonly [K in keyof T]: ConditionalDeep<T[K]> } : T

/** More library mapped types around a model than are unwrapped */
export declare const wrapped: Readonly<
  Partial<Required<Readonly<Partial<Required<Readonly<Partial<Required<Box<Model>>>>>>>>>
>

/** A model nesting itself with its type arguments swapped */
export interface Swap<A, B> {
  a: A
  next: Swap<B, A> | null
}

export declare const swapped: Swap<string, number>

/** A model nesting itself with a type argument that differs only deep inside */
export interface Deep<T> {
  v: T
  other: Deep<Box<Box<Box<Box<string>>>>> | null
}

export declare const deep: Deep<Box<Box<Box<Box<number>>>>>

/** A model nesting itself with another union for a type argument */
export interface Nullable<T> {
  v: T
  other: Nullable<Box<string> | null> | null
}

export declare const nullable: Nullable<Box<number> | null>

/** A generic model nesting its type argument through a union, a member of which holds a list of it */
export interface ViaUnion<T> {
  inner: { other: string } | { a: T; m: ViaUnion<T>[] }
}

export declare const viaUnions: ConditionalDeep<
  ViaUnion<ViaUnion<ViaUnion<ViaUnion<ViaUnion<ViaUnion<number>>>>>>
>

/** A generic model nesting its type argument beside a conditional type of it */
export interface ViaConditional<T> {
  inner: { c: T extends string ? 1 : 2; a: T; l: ViaConditional<T>[] }
}

export declare const viaConditionals: ConditionalDeep<
  ViaConditional<
    ViaConditional<ViaConditional<ViaConditional<ViaConditional<ViaConditional<number>>>>>
  >
>

/** A generic model nesting its type argument in an object literal with an index signature of it */
export interface ViaIndex<T> {
  inner: { [key: string]: ViaIndex<T> | T | ViaIndex<T>[]; a: T; l: ViaIndex<T>[] }
}

export declare const viaIndexes: ConditionalDeep<
  ViaIndex<ViaIndex<ViaIndex<ViaIndex<ViaIndex<ViaIndex<number>>>>>>
>

export interface Wrapper<T> {
  w: T
}

/** A generic model nesting its type argument directly, or through a generic model */
export interface ViaWrapper<T> {
  inner: Wrapper<T> | T | (T extends string ? 1 : 2)
}

export declare const viaWrappers: ConditionalDeep<
  ViaWrapper<ViaWrapper<ViaWrapper<ViaWrapper<ViaWrapper<ViaWrapper<number>>>>>>
>

/** Each value, read-only, deeply, through another alias at every other level */
type AlternatingDeep<T> = T extends object
  ? { readonly [K in keyof T]: AlternatingDeepValue<T[K]> }
  : T

type AlternatingDeepValue<T> = T extends object
  ? { readonly [K in keyof T]: AlternatingDeep<T[K]> }
  : T

/** A generic model nesting its type argument in the values of its index signature */
export interface ViaIndexValues<T> {
  [key: string]: { p: T; l: ViaIndexValues<T>[] }
}

/** The same, holding its type argument in a property no declaration names */
export interface ViaRecordValues<T> {
  [key: string]: Record<'p', T> & { l: ViaRecordValues<T>[] }
}

export declare const alternatingRecords: AlternatingDeep<
  ViaRecordValues<
    ViaRecordValues<ViaRecordValues<ViaRecordValues<ViaRecordValues<ViaRecordValues<number>>>>>
  >
>

export declare const alternating: AlternatingDeep<
  ViaIndexValues<
    ViaIndexValues<ViaIndexValues<ViaIndexValues<ViaIndexValues<ViaIndexValues<number>>>>>
  >
>
