import { splitInHalf, toArray } from './array.ts'

it('toArray', () => {
  expect(toArray(undefined)).toEqual([])
  expect(toArray(null)).toEqual([])
  expect(toArray(1)).toEqual([1])
  expect(toArray([1])).toEqual([1])
})

it('splitInHalf', () => {
  expect(splitInHalf([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]])
  expect(splitInHalf([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]])
  expect(splitInHalf([1, 2, 3])).toEqual([[1, 2], [3]])
  expect(splitInHalf([1, 2])).toEqual([[1], [2]])
  expect(splitInHalf([1])).toEqual([[1], []])
  expect(splitInHalf([])).toEqual([[], []])
})
