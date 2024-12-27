import { computed, ref, shallowRef } from 'vue'
import { deepUnref } from './utils'

describe('deepUnref', () => {
  // Primitive types
  it('should handle primitive types', () => {
    expect(deepUnref(1)).toBe(1)
    expect(deepUnref('hello')).toBe('hello')
    expect(deepUnref(true)).toBe(true)
    expect(deepUnref(null)).toBe(null)
    expect(deepUnref(undefined)).toBe(undefined)
  })

  // Simple ref unwrapping
  it('should unwrap simple refs', () => {
    expect(deepUnref(ref(1))).toBe(1)
    expect(deepUnref(ref('hello'))).toBe('hello')
    expect(deepUnref(ref(true))).toBe(true)
  })

  // Nested refs in objects
  it('should unwrap nested refs in objects', () => {
    const input = {
      a: ref(1),
      b: {
        c: ref('hello'),
      },
    }
    const result = deepUnref(input)
    expect(result).toEqual({
      a: 1,
      b: {
        c: 'hello',
      },
    })
  })

  // Nested refs in arrays
  it('should unwrap nested refs in arrays', () => {
    const input = [ref(1), { a: ref('hello') }, [ref(2)]]
    const result = deepUnref(input)
    expect(result).toEqual([1, { a: 'hello' }, [2]])
  })

  // Computed refs
  it('should handle computed refs', () => {
    const input = computed(() => ref(1))
    expect(deepUnref(input)).toBe(1)

    const nestedComputed = computed(() => ({
      a: ref({ b: ref(2) }),
    }))
    const result = deepUnref(nestedComputed)
    expect(result).toEqual({
      a: { b: 2 },
    })
  })

  it('should unwrap shallow refs', () => {
    const input = shallowRef({ a: ref(1) })
    const result = deepUnref(input)
    expect(result).toEqual({ a: 1 })

    const deepInput = shallowRef({ a: { b: ref(2) } })
    const deepResult = deepUnref(deepInput)
    expect(deepResult).toEqual({ a: { b: 2 } })
  })

  // Functions should remain unchanged
  it('should not unwrap functions', () => {
    const handler = () => 'hello'
    expect(deepUnref(handler)).toBe(handler)

    const inputWithFunc = {
      a: ref(1),
      b: () => 'world',
    }
    const result = deepUnref(inputWithFunc)
    expect(result).toEqual({
      a: 1,
      b: inputWithFunc.b,
    })
  })

  // Complex nested scenarios
  it('should handle complex nested scenarios', () => {
    const complexInput = {
      a: ref(1),
      b: {
        c: computed(() => ref({ d: ref(2) })),
        e: [ref(3), shallowRef({ f: ref(4) })],
      },
    }
    const result = deepUnref(complexInput)
    expect(result).toEqual({
      a: 1,
      b: {
        c: { d: 2 },
        e: [3, { f: 4 }],
      },
    })
  })
})
