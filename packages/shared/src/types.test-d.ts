import type { DistributiveOmit, IntersectPick, PromiseWithError, Public } from './types'

interface Empty {}

it('IntersectPick', () => {
  expectTypeOf<IntersectPick<{ a: number }, { a: number; b: number }>>().toEqualTypeOf<{
    a: number
  }>()
  expectTypeOf<IntersectPick<{ a: number; b: number }, { b: number }>>().toEqualTypeOf<{
    b: number
  }>()
  expectTypeOf<IntersectPick<{ a: number }, { b: number }>>().toEqualTypeOf<Empty>()
})

// How `.use` applies it: the override `U` is checked against `IntersectPick<T, U>`
type Accepts<T, U> = [U] extends [IntersectPick<T, U>] ? true : false

it('IntersectPick with union', () => {
  type A = { kind: 'a'; user: { id: string } }
  type T = A | { kind: 'b' }

  expectTypeOf<Accepts<T, { user: { id: string } }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { other: number }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { user: number }>>().toEqualTypeOf<false>()
  // leaves the `kind: 'b'` member with `kind: 'a'` and no `user`
  expectTypeOf<Accepts<T, { kind: 'a' }>>().toEqualTypeOf<false>()
  expectTypeOf<Accepts<T, { kind: 'c'; user: { id: string } }>>().toEqualTypeOf<false>()
})

it('IntersectPick allows narrowing a union', () => {
  type A = { kind: 'a'; user: { id: string } }
  type T = A | { kind: 'b' }

  expectTypeOf<Accepts<T, A>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { kind: 'b' }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { kind: 'b'; user: number }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, T>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, A | { kind: 'c' }>>().toEqualTypeOf<false>()

  type N = { user: { id: string } } | { user: null }
  expectTypeOf<Accepts<N, { user: { id: string } }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<N, { user: number }>>().toEqualTypeOf<false>()
})

it('IntersectPick with index signature', () => {
  type T = { [k: string]: unknown; db: string }

  expectTypeOf<Accepts<T, { [k: string]: unknown; db: string }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { user: number }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { [k: string]: unknown; db: number }>>().toEqualTypeOf<false>()
  expectTypeOf<Accepts<T, Record<string, unknown>>>().toEqualTypeOf<false>()
  expectTypeOf<Accepts<T, { db: number }>>().toEqualTypeOf<false>()
})

it('IntersectPick with union override', () => {
  type T = { db: string; user: { id: string } }

  expectTypeOf<Accepts<T, { db: string } | { user: { id: string } }>>().toEqualTypeOf<true>()
  expectTypeOf<Accepts<T, { db: string } | { user: number }>>().toEqualTypeOf<false>()
})

it('DistributiveOmit', () => {
  expectTypeOf<DistributiveOmit<{ a: number; b: number }, 'b'>>().toEqualTypeOf<{ a: number }>()
  expectTypeOf<DistributiveOmit<{ readonly a?: number; b: number }, 'b'>>().toEqualTypeOf<{
    readonly a?: number
  }>()
  expectTypeOf<
    DistributiveOmit<{ kind: 'a'; a: number; c: number } | { kind: 'b'; b: number; c: number }, 'c'>
  >().toEqualTypeOf<{ kind: 'a'; a: number } | { kind: 'b'; b: number }>()
  expectTypeOf<
    DistributiveOmit<{ [k: string]: unknown; a: number; b: number }, 'b'>
  >().toEqualTypeOf<{ [k: string]: unknown; a: number }>()
})

it('PromiseWithError', () => {
  type C = PromiseWithError<number | undefined | null, Error | undefined | null>

  expectTypeOf<C extends Promise<infer T> ? T : never>().toEqualTypeOf<number | undefined | null>()
  expectTypeOf<C extends PromiseWithError<infer T, infer E> ? [T, E] : never>().toEqualTypeOf<
    [number | undefined | null, Error | undefined | null]
  >()
})

it('Public', () => {
  class A {
    public a = 1
    protected b = 2
    private c = 3
  }

  expectTypeOf<Public<A>>().toEqualTypeOf<{ a: number }>()
})
