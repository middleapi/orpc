type Brand = { readonly __brand: 'key' }

/** A template of a `bigint`, which TypeScript accepts integer literals of */
export type BigIntTemplate = `id-${bigint}`

/** Templates of branded literals and primitives, which the checker does not fold */
export type BrandedLiteralTemplate = `${'v' & Brand}-${1 & Brand}`

export type BrandedPrimitiveTemplate = `${number & Brand}:${string & Brand}`

/** A generic template, of a type parameter the checker does not know the strings of */
export type GenericTemplate<T extends string> = `x-${T & Brand}`
