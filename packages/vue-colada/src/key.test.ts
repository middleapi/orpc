import { buildKey } from './key'

it('buildKey', () => {
  expect(buildKey(['path'])).toEqual([['path'], {}])
  expect(buildKey(['path', 'path2'], { input: { a: 1 } })).toEqual([['path', 'path2'], { input: { a: 1 } }])
  expect(buildKey(['path'], { input: undefined })).toEqual([['path'], {}])
  expect(buildKey(['path', 'path2'], { type: 'query' })).toEqual([['path', 'path2'], { type: 'query' }])
  expect(buildKey(['path'], { type: undefined })).toEqual([['path'], {}])
  expect(buildKey(['path', 'path2'], { type: 'query', input: { a: 1 } })).toEqual([['path', 'path2'], { type: 'query', input: { a: 1 } }])
  expect(buildKey(['path'], { type: 'mutation' })).toEqual([['path'], { type: 'mutation' }])

  const date = new Date()
  expect(buildKey(['path', 'path2'], { input: { a: date } })).toEqual([['path', 'path2'], { input: { a: date.toISOString() } }])
})
