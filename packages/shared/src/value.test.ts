import { value } from './value.ts'

it('value', async () => {
  expect(value(42)).toBe(42)
  expect(value(() => 42)).toBe(42)
  expect(await value(async () => 42)).toBe(42)

  expect(
    await value(async () => ({
      // oxlint-disable-next-line unicorn/no-thenable
      then: (resolve: (value: PromiseLike<number>) => void) => resolve(Promise.resolve(42)),
    })),
  ).toBe(42)

  expect(value(() => ({ value: '42' }))).toEqual({ value: '42' })
})
