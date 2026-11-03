import { isStreamBody, isStreamInput } from './utils'

const stream = () => new Blob(['payload']).stream()
const iterator = () => (async function* () {})()

it.each([
  [stream(), true],
  [iterator(), true],
  [new Blob(['payload']), false],
  ['payload', false],
  [undefined, false],
  [{ body: stream() }, false],
])('isStreamBody(%#) -> %s', (body, expected) => {
  expect(isStreamBody(body)).toBe(expected)
})

it.each([
  [stream(), true],
  [iterator(), true],
  [{ body: stream() }, true],
  [{ params: { id: '1' }, body: iterator() }, true],
  [[stream()], true],
  [{ body: { nested: stream() } }, false],
  [{ body: new Blob(['payload']) }, false],
  [{ name: 'Earth' }, false],
  ['payload', false],
  [null, false],
  [undefined, false],
])('isStreamInput(%#) -> %s', (input, expected) => {
  expect(isStreamInput(input)).toBe(expected)
})
