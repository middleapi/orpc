declare const brand: unique symbol

export type Brand<T, TName extends string> = T & { readonly [brand]: TName }
