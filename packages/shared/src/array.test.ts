import { limitArraySize, splitInHalf, toArray } from './array.ts'

it('toArray', () => {
  expect(toArray(undefined)).toEqual([])
  expect(toArray(null)).toEqual([])
  expect(toArray(1)).toEqual([1])
  expect(toArray([1])).toEqual([1])
})

it('splitInHalf', () => {
  expect(splitInHalf([1, 2, 3, 4, 5])).toEqual([
    [1, 2, 3],
    [4, 5],
  ])
  expect(splitInHalf([1, 2, 3, 4])).toEqual([
    [1, 2],
    [3, 4],
  ])
  expect(splitInHalf([1, 2, 3])).toEqual([[1, 2], [3]])
  expect(splitInHalf([1, 2])).toEqual([[1], [2]])
  expect(splitInHalf([1])).toEqual([[1], []])
  expect(splitInHalf([])).toEqual([[], []])
})

it('limitArraySize', () => {
  const items = [1, 2, 3]
  expect(limitArraySize(items, 3)).toBe(items)
  expect(limitArraySize(items, Number.POSITIVE_INFINITY)).toBe(items)
  expect(limitArraySize(items, 2)).toEqual([2, 3])
  expect(limitArraySize(items, 0)).toEqual([])
  expect(items).toEqual([1, 2, 3])
})
