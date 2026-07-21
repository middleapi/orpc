import { generateOperationKey } from './key'

it('generateOperationKey', () => {
  expect(generateOperationKey(['path'])).toEqual([['path'], {}])
  expect(generateOperationKey(['planet', 'create'], { type: 'mutation' }))
    .toEqual([['planet', 'create'], { type: 'mutation' }])
  expect(generateOperationKey(['planet', 'find'], { type: 'query', input: { id: 1 } }))
    .toEqual([['planet', 'find'], { type: 'query', input: { id: 1 } }])
  expect(generateOperationKey(['planet', 'stream'], { type: 'streamed', input: { cursor: 0 }, fnOptions: { refetchMode: 'append' } }))
    .toEqual([['planet', 'stream'], { type: 'streamed', input: { cursor: 0 }, fnOptions: { refetchMode: 'append' } }])

  expect(generateOperationKey(['planet', 'find'], { back: 1 })).toEqual([['planet'], {}])
  expect(generateOperationKey(['planet', 'find'], { back: 10 })).toEqual([[], {}])
  expect(generateOperationKey(['planet', 'find'], { back: 0 })).toEqual([['planet', 'find'], {}])
  expect(generateOperationKey(['planet', 'find'], { back: 0.5 })).toEqual([['planet', 'find'], {}])
  expect(generateOperationKey(['planet', 'find'], { back: 1.5 })).toEqual([['planet'], {}])
  expect(generateOperationKey(['planet', 'find'], { back: -1 })).toEqual([['planet', 'find'], {}])
  expect(generateOperationKey(['planet', 'find'], { prefix: '__prefix__', back: 1, type: 'query' })).toEqual(['__prefix__', ['planet'], { type: 'query' }])

  expect(generateOperationKey(['path'], { prefix: '__prefix__' })).toEqual(['__prefix__', ['path'], {}])
  expect(generateOperationKey(['path'], { prefix: undefined })).toEqual([['path'], {}])
  expect(generateOperationKey(['path'], { prefix: '__prefix__', type: 'query', input: { a: 1 } })).toEqual(['__prefix__', ['path'], { type: 'query', input: { a: 1 } }])
})
