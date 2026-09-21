import { type } from 'arktype'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { clone, copyOnWrite, findDeepMatches, get, getConstructor, isObject, isPropertyKey, isTypescriptObject, NullProtoObj, setOwn } from './object'

it('findDeepMatches', () => {
  const { maps, values } = findDeepMatches(v => typeof v === 'string', {
    array: ['v1', 'v2'],
    nested: {
      nested: [
        {
          nested: {
            v: 'v3',
          },
        },
        'v4',
      ],
    },
  })

  expect(maps).toEqual([
    ['array', 0],
    ['array', 1],
    ['nested', 'nested', 0, 'nested', 'v'],
    ['nested', 'nested', 1],
  ])

  expect(values).toEqual([
    'v1',
    'v2',
    'v3',
    'v4',
  ])
})

it('getConstructor', () => {
  expect(getConstructor(null)).toBeNull()
  expect(getConstructor(undefined)).toBeNull()
  expect(getConstructor(true)).toBeNull()

  expect(getConstructor({})).toBe(Object)
  expect(getConstructor(new Error('hi'))).toBe(Error)
  expect(getConstructor(new NullProtoObj())).toBeUndefined()
  expect(getConstructor(() => { })).toBe(Function)
})

it('isObject', () => {
  expect(new Error('hi')).not.toSatisfy(isObject)
  expect(new Map()).not.toSatisfy(isObject)
  expect(new Set()).not.toSatisfy(isObject)
  expect(new Date()).not.toSatisfy(isObject)
  expect(false).not.toSatisfy(isObject)
  expect([]).not.toSatisfy(isObject)

  expect({}).toSatisfy(isObject)
  expect(Object.create(null)).toSatisfy(isObject)
  expect((() => {
    const obj = {}
    Object.setPrototypeOf(obj, null)
    return obj
  })()).toSatisfy(isObject)
})

it('isTypescriptObject', () => {
  expect(new Error('hi')).toSatisfy(isTypescriptObject)
  expect({}).toSatisfy(isTypescriptObject)
  expect(() => { }).toSatisfy(isTypescriptObject)
  expect(new Proxy({}, {})).toSatisfy(isTypescriptObject)

  expect(1).not.toSatisfy(isTypescriptObject)
  expect(null).not.toSatisfy(isTypescriptObject)
  expect(undefined).not.toSatisfy(isTypescriptObject)
  expect(true).not.toSatisfy(isTypescriptObject)
})

it('clone', () => {
  expect(clone(null)).toBeNull()

  const obj = { a: 1, arr: [2, 3], nested: { arr: [{ b: 4 }] } }
  const cloned = clone(obj)

  expect(cloned).toEqual(obj)
  expect(cloned).not.toBe(obj)
  expect(cloned.arr).not.toBe(obj.arr)
  expect(cloned.nested.arr).not.toBe(obj.nested.arr)
})

it('clone with symbol properties', () => {
  const sym = Symbol('test')
  const nestedSym = Symbol('nested')
  const obj = { a: 1, [sym]: { b: 2, [nestedSym]: 3 } }
  const cloned = clone(obj)

  expect(cloned.a).toBe(1)
  expect(cloned[sym]).toEqual({ b: 2, [nestedSym]: 3 })
  expect(cloned[sym]).not.toBe(obj[sym])
  expect(cloned[sym][nestedSym]).toBe(3)
})

it('get', () => {
  expect(get({ a: { b: 1 } }, ['a', 'b'])).toEqual(1)
  expect(get({ a: { b: 1 } }, ['a', 'b', 'c'])).toEqual(undefined)
  expect(get({ a: { b: 1 } }, ['a', 'b', 'c', 'd'])).toEqual(undefined)
  expect(get({ a: { b: () => { } } }, ['a', 'b', 'name'])).toEqual('b')
  expect(get({ a: { b: () => { } } }, ['a', 'b', 'uuuu'])).toEqual(undefined)
  expect(get({ a: { b: () => { } } }, ['a', 'b', 'uuuu', 'zzzz'])).toEqual(undefined)
})

it('isPropertyKey', () => {
  expect(isPropertyKey('a')).toBe(true)
  expect(isPropertyKey(1)).toBe(true)
  expect(isPropertyKey(Symbol('a'))).toBe(true)

  expect(isPropertyKey({})).toBe(false)
  expect(isPropertyKey([])).toBe(false)
  expect(isPropertyKey(null)).toBe(false)
})

it('nullProtoObj', () => {
  const obj = new NullProtoObj()

  obj.a = 1
  // eslint-disable-next-line no-restricted-properties, no-proto
  obj.__proto__ = 2

  expect(obj).toSatisfy(isObject)

  expect(obj.a).toBe(1)
  // eslint-disable-next-line no-restricted-properties, no-proto
  expect(obj.__proto__).toBe(2)

  // compatible with common validation libs
  expect(z.object({ a: z.number() }).parse(obj)).toEqual(expect.objectContaining({ a: 1 }))
  expect(v.parse(v.object({ a: v.number() }), obj)).toEqual(expect.objectContaining({ a: 1 }))
  expect(type({ a: 'number' })(obj)).toEqual(expect.objectContaining({ a: 1 }))

  const clone = { ...obj }
  expect(Object.getPrototypeOf(clone).constructor).toBe(Object)
  // eslint-disable-next-line no-restricted-properties, no-proto
  expect(clone.__proto__).toBe(2)
  expect(clone.a).toBe(1)
})

it('setOwn', () => {
  const object: Record<string, unknown> = {}

  setOwn(object, 'a', 1)
  setOwn(object, '__proto__', { b: 2 })

  expect(object.a).toBe(1)
  expect(Object.getOwnPropertyDescriptor(object, '__proto__')?.value).toEqual({ b: 2 })
  expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
})

describe('copyOnWrite', () => {
  it('copies arrays and plain objects still held by the input, returns everything else as is', () => {
    const child = { a: 1 }
    const list = [1]
    const parent = { child, list, date: new Date(), none: null }

    const childCopy = copyOnWrite(parent, 'child', child)
    expect(childCopy).toEqual(child)
    expect(childCopy).not.toBe(child)
    expect(parent.child).toBe(childCopy)
    expect(copyOnWrite(parent, 'child', child)).toBe(childCopy)

    const listCopy = copyOnWrite(parent, 'list', list)
    expect(listCopy).toEqual(list)
    expect(listCopy).not.toBe(list)
    expect(parent.list).toBe(listCopy)

    expect(copyOnWrite(parent, 'date', parent.date)).toBe(parent.date)
    expect(copyOnWrite(parent, 'none', null)).toBeNull()
  })

  it('keeps __proto__ an own property on the parent and the copy', () => {
    const parent = JSON.parse('{"__proto__": {"a": 1}}')
    const original = Object.getOwnPropertyDescriptor(parent, '__proto__')?.value

    const copy = copyOnWrite(parent, '__proto__', original) as any

    expect(Object.getPrototypeOf(parent)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(parent, '__proto__')?.value).toBe(copy)
    expect(copy).toEqual({ a: 1 })
    expect(({} as any).a).toBeUndefined()
  })
})
