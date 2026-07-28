import { getEventMeta, withEventMeta } from './meta'

it('get/withEventMeta', () => {
  const data = { value: 123, meta: undefined }
  const applied = withEventMeta(data, { id: '123', retry: 10000, comments: ['hello', 'world'] })
  expect(applied).toEqual(data)
  expect(applied).not.toBe(data)
  expect(getEventMeta(applied)).toEqual({ id: '123', retry: 10000, comments: ['hello', 'world'] })
  expect(getEventMeta(data)).toEqual(undefined)
  expect(getEventMeta(1)).toEqual(undefined)

  expect(() => withEventMeta(data, { id: '123\n' })).toThrow('Event\'s id must not contain a carriage return or newline character')
  expect(() => withEventMeta(data, { retry: Number.NaN })).toThrow('Event\'s retry must be a integer and >= 0')
  expect(() => withEventMeta(data, { retry: 1.1 })).toThrow('Event\'s retry must be a integer and >= 0')
  expect(() => withEventMeta(data, { retry: -1 })).toThrow('Event\'s retry must be a integer and >= 0')
  expect(() => withEventMeta(data, { comments: ['hi\n'] })).toThrow('Event\'s comment must not contain a carriage return or newline character')
})

it('withEventMeta only proxy when make sense', () => {
  const data = { value: 123, meta: undefined }

  expect(withEventMeta(data, { id: '123', retry: 10000, comments: ['hello', 'world'] })).not.toBe(data)
  expect(withEventMeta(data, { id: '' })).not.toBe(data)
  expect(withEventMeta(data, { retry: 0 })).not.toBe(data)
  expect(withEventMeta(data, { comments: [''] })).not.toBe(data)

  expect(withEventMeta(data, {})).toBe(data)
  expect(withEventMeta(data, { notExists: true } as any)).toBe(data)
  expect(withEventMeta(data, { id: undefined })).toBe(data)
  expect(withEventMeta(data, { comments: [] })).toBe(data)
})
