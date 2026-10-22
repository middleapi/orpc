import type { DistributiveOmit, MergedSchema, Schema } from './index'
import { expectTypeOf, it } from 'vitest'

it('exports helper types that can appear in inferred builder types', () => {
  // Without these re-exports, declaration emit for code depending only on `@orpc/server`
  // fails with "cannot be named without a reference to ... This is likely not portable".
  expectTypeOf<MergedSchema<Schema<{ a: string }, { a: number }>, Schema<{ b: string }, { b: number }>>>()
    .toEqualTypeOf<Schema<{ a: string } & { b: string }, { a: number } & { b: number }>>()

  expectTypeOf<DistributiveOmit<{ a: string, b: number } | { b: number, c: boolean }, 'b'>>()
    .toEqualTypeOf<{ a: string } | { c: boolean }>()
})
