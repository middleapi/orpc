import { resolveMaybeOptionalOptions } from './args'

it('resolveMaybeOptionalOptions', () => {
  expect(resolveMaybeOptionalOptions([{ a: 1 }])).toEqual({ a: 1 })
  expect(resolveMaybeOptionalOptions([undefined])).toEqual({})
  expect(resolveMaybeOptionalOptions([])).toEqual({})
})
