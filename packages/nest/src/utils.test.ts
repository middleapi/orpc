import { toNestPattern } from './utils'

it('toNestPattern', () => {
  expect(toNestPattern('/ping')).toBe('/ping')
  expect(toNestPattern('/ping')).toBe('/ping')
  expect(toNestPattern('/{id}')).toBe('/:id')
  expect(toNestPattern('/{id}/{+path}')).toBe('/:id/*path')

  expect(toNestPattern('/{id}/name{name}')).toBe('/:id/name{name}')
})
