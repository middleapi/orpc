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

  const c = (...[options]: MaybeOptionalOptions<Record<string, unknown>>) => {
    expectTypeOf(options).toEqualTypeOf<Record<string, unknown> | undefined>()
  }

  // index signatures accept an empty object, so options is optional
  c()
  c({ any: 1 })

  const d = (...[options]: MaybeOptionalOptions<Record<string, unknown> & { d: number }>) => {
    expectTypeOf(options).toEqualTypeOf<Record<string, unknown> & { d: number }>()
  }

  // @ts-expect-error - options is required
  d()
  d({ d: 1 })
})
