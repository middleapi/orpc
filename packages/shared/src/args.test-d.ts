import type { MaybeOptionalOptions } from './args'
import { resolveMaybeOptionalOptions } from './args'

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

  c()
  c({ any: 1 })

  const d = (...[options]: MaybeOptionalOptions<Record<string, unknown> & { d: number }>) => {
    expectTypeOf(options).toEqualTypeOf<Record<string, unknown> & { d: number }>()
  }

  // @ts-expect-error - options is required
  d()
  d({ d: 1 })
})

it('resolveMaybeOptionalOptions', () => {
  const a = (...rest: MaybeOptionalOptions<{ a: number }>) => resolveMaybeOptionalOptions(rest)
  expectTypeOf(a).returns.toEqualTypeOf<{ a: number }>()

  // also accepts any optional-options tuple, not only `MaybeOptionalOptions`
  const b = (...rest: [options?: { b?: number }]) => resolveMaybeOptionalOptions(rest)
  expectTypeOf(b).returns.toEqualTypeOf<{ b?: number }>()
})
