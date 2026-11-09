import type { MaybeOptionalOptions } from './args'

it('MaybeOptionalOptions', () => {
  const a = (...[options]: MaybeOptionalOptions<{ a: number }>) => {
    expectTypeOf(options).toEqualTypeOf<{ a: number }>()
  }

  // @ts-expect-error - options is required
  a()
  // @ts-expect-error - options is invalid
  a({ a: '1' })
  a({ a: 1 })

  const b = (...[options]: MaybeOptionalOptions<{ b?: number }>) => {
    expectTypeOf(options).toEqualTypeOf<{ b?: number } | undefined>()
  }

  b()
  // @ts-expect-error - options is invalid
  b({ b: '1' })
  b({ b: 1 })
})
