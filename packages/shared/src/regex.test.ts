import { INTEGER_REGEX, NON_NEGATIVE_INTEGER_REGEX } from './regex.ts'

it.each([
  ['0', true],
  ['42', true],
  ['-42', true],
  ['-0', true],
  ['007', false],
  ['1.5', false],
  ['+1', false],
  ['', false],
  ['1e3', false],
])('INTEGER_REGEX %s: %s', (value, expected) => {
  expect(INTEGER_REGEX.test(value)).toBe(expected)
})

it.each([
  ['0', true],
  ['42', true],
  ['-1', false],
  ['01', false],
  ['1.0', false],
  ['', false],
])('NON_NEGATIVE_INTEGER_REGEX %s: %s', (value, expected) => {
  expect(NON_NEGATIVE_INTEGER_REGEX.test(value)).toBe(expected)
})
