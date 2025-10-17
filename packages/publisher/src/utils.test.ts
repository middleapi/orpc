import { compareRedisStreamIds } from './utils'

it('compareRedisStreamIds', () => {
  // throw on invalid format
  expect(() => compareRedisStreamIds('123', '222')).toThrow(TypeError)

  expect(compareRedisStreamIds('1-1', '1-2')).toBeLessThan(0)
  expect(compareRedisStreamIds('1-0', '2-0')).toBeLessThan(0)

  expect(compareRedisStreamIds('1-1', '1-1')).toBe(0)
  expect(compareRedisStreamIds('73892329-0', '73892329-0')).toBe(0)

  expect(compareRedisStreamIds('1-2', '1-1')).toBeGreaterThan(0)
  expect(compareRedisStreamIds('2-0', '1-0')).toBeGreaterThan(0)
  expect(compareRedisStreamIds('100034343-20', '100034343-1')).toBeGreaterThan(0)
})
