export type Meta = Record<string, any>

/**
 * Merges two meta types with override semantics matching runtime spread:
 * keys in `U` replace keys in `T`.
 */
export type MergedMeta<T extends Meta, U extends Meta> = Omit<T, keyof U> & U

export function mergeMeta<T extends Meta, U extends Meta>(meta1: T, meta2: U): MergedMeta<T, U> {
  return { ...meta1, ...meta2 }
}
