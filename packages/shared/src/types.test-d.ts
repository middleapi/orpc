import type { IntersectPick, PromiseWithError, Public, SetOptional } from './types'

interface Empty {}

it('IntersectPick', () => {
  expectTypeOf<IntersectPick<{ a: number }, { a: number, b: number }>>().toEqualTypeOf<{ a: number }>()
  expectTypeOf<IntersectPick<{ a: number, b: number }, { b: number }>>().toEqualTypeOf<{ b: number }>()
  expectTypeOf<IntersectPick<{ a: number }, { b: number }>>().toEqualTypeOf<Empty>()
})

it('SetOptional', () => {
  type A = SetOptional<{ a: number, b: number }, 'a'>

  expectTypeOf<A['a']>().toEqualTypeOf<number | undefined>()
  expectTypeOf<A['b']>().toEqualTypeOf<number>()
  expectTypeOf({ b: 1 }).toExtend<A>()
  expectTypeOf({ a: 1, b: 1 }).toExtend<A>()
  expectTypeOf({ a: 1 }).not.toExtend<A>()
})

it('PromiseWithError', () => {
  type C = PromiseWithError<number | undefined | null, Error | undefined | null>

  expectTypeOf<C extends Promise<infer T> ? T : never>().toEqualTypeOf<number | undefined | null>()
  expectTypeOf<C extends PromiseWithError<infer T, infer E> ? [T, E] : never>().toEqualTypeOf<[number | undefined | null, Error | undefined | null]>()
})

it('Public', () => {
  class A {
    public a = 1
    protected b = 2
    private c = 3
  }

  expectTypeOf<Public<A>>().toEqualTypeOf<{ a: number }>()
})
