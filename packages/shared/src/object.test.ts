import * as a from 'arktype'
import * as v from 'valibot'
import z from 'zod'
import { bindMethods, clone, findDeepMatches, get, getConstructor, isPlainObject, isPropertyKey, NullProtoObj, omit, set } from './object'

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
  expect(getConstructor(() => { })).toBe(Function)
})

it('isPlainObject', () => {
  expect(new Error('hi')).not.toSatisfy(isPlainObject)
  expect(new Map()).not.toSatisfy(isPlainObject)
  expect(new Set()).not.toSatisfy(isPlainObject)
  expect(new Date()).not.toSatisfy(isPlainObject)
  expect(false).not.toSatisfy(isPlainObject)
  expect([]).not.toSatisfy(isPlainObject)

  expect({}).toSatisfy(isPlainObject)
  expect(Object.create(null)).toSatisfy(isPlainObject)
  expect((() => {
    const obj = {}
    Object.setPrototypeOf(obj, null)
    return obj
  })()).toSatisfy(isPlainObject)
})

it('get', () => {
  expect(get({ a: { b: 1 } }, ['a', 'b'])).toEqual(1)
  expect(get({ a: { b: 1 } }, ['a', 'b', 'c'])).toEqual(undefined)
  expect(get({ a: { b: 1 } }, ['a', 'b', 'c', 'd'])).toEqual(undefined)
  expect(get({ a: { b: () => { } } }, ['a', 'b', 'name'])).toEqual('b')
  expect(get({ a: { b: () => { } } }, ['a', 'b', 'uuuu'])).toEqual(undefined)
  expect(get({ a: { b: () => { } } }, ['a', 'b', 'uuuu', 'zzzz'])).toEqual(undefined)
})

describe('set', () => {
  it('sets a value at a single-key path', () => {
    const root = {}
    set(root, ['a'], 1)
    expect(root).toEqual({ a: 1 })
  })

  it('sets a value at a nested path', () => {
    const root = {}
    set(root, ['a', 'b', 'c'], 'value')
    expect(root).toEqual({ a: { b: { c: 'value' } } })
  })

  it('overwrites an existing value', () => {
    const root = { a: 1 }
    set(root, ['a'], 2)
    expect(root).toEqual({ a: 2 })
  })

  it('overwrites a non-object intermediate with a plain object', () => {
    const root: Record<string, unknown> = { a: 42 }
    set(root, ['a', 'b'], 'value')
    expect(root).toEqual({ a: { b: 'value' } })
  })

  it('preserves existing sibling keys when setting nested values', () => {
    const root = { a: { x: 1 } }
    set(root, ['a', 'b'], 2)
    expect(root).toEqual({ a: { x: 1, b: 2 } })
  })

  it('supports symbol keys', () => {
    const root: Record<PropertyKey, unknown> = {}
    const sym = Symbol('key')
    set(root, [sym], 'sym-value')
    expect(root[sym]).toBe('sym-value')
  })

  it('supports number keys', () => {
    const root: Record<PropertyKey, unknown> = {}
    set(root, [0, 1], 'nested')
    expect((root[0] as Record<PropertyKey, unknown>)[1]).toBe('nested')
  })

  it('sets value to null', () => {
    const root: Record<string, unknown> = {}
    set(root, ['a'], null)
    expect(root).toEqual({ a: null })
  })

  it('sets value to undefined', () => {
    const root: Record<string, unknown> = {}
    set(root, ['a'], undefined)
    expect(root).toEqual({ a: undefined })
  })

  it('treats an array intermediate as an object (does not replace it)', () => {
    const root: Record<string, unknown> = { a: [1, 2, 3] }
    set(root, ['a', 'b'], 'value')
    const arr = root.a as Record<string, unknown>
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.b).toBe('value')
  })

  it('treats a class instance intermediate as an object (does not replace it)', () => {
    const date = new Date()
    const root: Record<string, unknown> = { a: date }
    set(root, ['a', 'b'], 'value')
    expect(root.a).toBe(date)
    expect((root.a as Record<string, unknown>).b).toBe('value')
  })
})

describe('omit', () => {
  it('omits specified keys', () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ['b'])).toEqual({
      a: 1,
      c: 3,
    })
  })

  it('returns a new object', () => {
    const obj = { a: 1 }

    expect(omit(obj, [])).not.toBe(obj)
  })

  it('ignores missing keys', () => {
    expect(omit({ a: 1 }, ['b' as never])).toEqual({
      a: 1,
    })
  })

  it('omits multiple keys', () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({
      b: 2,
    })
  })
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

  expect(obj).toSatisfy(isPlainObject)

  expect(obj.a).toBe(1)
  // eslint-disable-next-line no-restricted-properties, no-proto
  expect(obj.__proto__).toBe(2)

  // compatible with common validation libs
  expect(z.object({ a: z.number() }).parse(obj)).toEqual(expect.objectContaining({ a: 1 }))
  expect(v.parse(v.object({ a: v.number() }), obj)).toEqual(expect.objectContaining({ a: 1 }))
  expect(a.type({ a: 'number' })(obj)).toEqual(expect.objectContaining({ a: 1 }))

  const clone = { ...obj }
  expect(Object.getPrototypeOf(clone).constructor).toBe(Object)
  // eslint-disable-next-line no-restricted-properties, no-proto
  expect(clone.__proto__).toBe(2)
  expect(clone.a).toBe(1)
})

describe('clone', () => {
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
})

describe('bindMethods', () => {
  const syb1 = Symbol('1')
  const syb2 = Symbol('2')

  it('binds own methods to the original object', () => {
    const obj = {
      value: 123,
      [syb1]: 234,
      getValue() {
        return this.value
      },
      [syb2]() {
        return this[syb1]
      },
    }

    const methods = bindMethods(obj)

    expect(methods.getValue()).toBe(123)
    expect(methods[syb2]()).toBe(234)
  })

  it('collects methods from the prototype chain', () => {
    class Base {
      value = 123

      getValue() {
        return this.value
      }

      [syb1]() {
        return this.value + 1
      }
    }

    class Child extends Base {
      double() {
        return this.value * 2
      }

      [syb2]() {
        return this.value + 2
      }
    }

    const methods = bindMethods(new Child())

    expect(methods.getValue()).toBe(123)
    expect(methods.double()).toBe(246)
    expect(methods[syb1]()).toBe(124)
    expect(methods[syb2]()).toBe(125)
  })

  it('prefers methods closer to the instance in the prototype chain', () => {
    class Base {
      value = 'base'

      getValue() {
        return this.value
      }

      [syb1]() {
        return 'Base'
      }
    }

    class Child extends Base {
      override getValue() {
        return 'child'
      }

      override [syb1]() {
        return 'Child'
      }
    }

    const methods = bindMethods(new Child())

    expect(methods.getValue()).toBe('child')
    expect(methods[syb1]()).toBe('Child')
  })

  it('ignores non-function properties', () => {
    const obj = {
      value: 123,
      name: 'test',
      [syb1]: 'ignore',
      getValue() {
        return this.value
      },
    }

    const methods = bindMethods(obj)

    expect('value' in methods).toBe(false)
    expect('name' in methods).toBe(false)
    expect(methods.getValue()).toBe(123)
  })

  it('does not include constructor', () => {
    class Test {
      method() {
        return 'ok'
      }
    }

    const methods = bindMethods(new Test())

    expect('constructor' in methods).toBe(false)
    expect(methods.method()).toBe('ok')
  })

  it('supports special method names such as toString and __proto__', () => {
    const obj = Object.create(null)

    obj.toString = function () {
      return 'custom'
    }

    // eslint-disable-next-line no-proto, no-restricted-properties
    obj.__proto__ = function () {
      return 'proto'
    }

    const methods = bindMethods(obj)

    expect(methods.toString()).toBe('custom')
    // eslint-disable-next-line no-proto, no-restricted-properties
    expect(methods.__proto__()).toBe('proto')
  })

  it('returns an NullProtoObj', () => {
    const methods = bindMethods({
      fn() {},
    })

    expect(Object.getPrototypeOf(methods)).toBe(Object.getPrototypeOf((new NullProtoObj())))
  })

  it('returns an empty object when no methods exist', () => {
    const methods = bindMethods({
      value: 123,
    })

    expect(Reflect.ownKeys(methods)).toEqual([])
  })
})
