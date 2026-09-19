import { createLazyRegExp, isValidRegExpFlags } from './regexp'

/**
 * `vi.spyOn(globalThis, 'RegExp')` swaps the global, so `instanceof RegExp` must use the original.
 */
const OriginalRegExp = RegExp

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isValidRegExpFlags', () => {
  it('accepts every valid combination', () => {
    for (const flags of ['', 'g', 'gi', 'dgimsuy', 'dgimsvy', 'ysmigd']) {
      expect(isValidRegExpFlags(flags)).toBe(true)
    }
  })

  it('rejects unknown, duplicated, or conflicting flags', () => {
    for (const flags of ['x', 'G', 'gg', 'uv', 'gi ', 'g\n']) {
      expect(isValidRegExpFlags(flags)).toBe(false)
    }
  })
})

describe('createLazyRegExp', () => {
  it('does not compile until first use', () => {
    const spy = vi.spyOn(globalThis, 'RegExp')

    const regexp = createLazyRegExp('uic', 'gi')
    expect(regexp).toBeInstanceOf(OriginalRegExp)
    expect(spy).not.toHaveBeenCalledWith('uic', 'gi')

    expect(regexp.test('UIC')).toBe(true)
    expect(spy).toHaveBeenCalledWith('uic', 'gi')
    const compiled = spy.mock.calls.length

    expect(regexp.source).toBe('uic')
    expect(regexp.flags).toBe('gi')
    expect(spy).toHaveBeenCalledTimes(compiled)
  })

  it('answers reads a fresh RegExp could answer without compiling', () => {
    const spy = vi.spyOn(globalThis, 'RegExp')
    const regexp = createLazyRegExp('uic', 'g')

    expect(regexp.lastIndex).toBe(0)
    expect((regexp as any).then).toBeUndefined()
    expect((regexp as any).toJSON).toBeUndefined()
    expect((regexp as any)[Symbol.for('nodejs.util.inspect.custom')]).toBeUndefined()
    expect(JSON.stringify({ regexp })).toBe('{"regexp":{}}')
    expect('lastIndex' in regexp).toBe(true)
    expect('exec' in regexp).toBe(true)
    expect('then' in regexp).toBe(false)
    expect(Object.hasOwn(regexp, 'lastIndex')).toBe(false)

    regexp.lastIndex = 2
    expect(regexp.lastIndex).toBe(2)
    expect(spy).not.toHaveBeenCalledWith('uic', 'g')

    expect(regexp.exec('uicuic')?.index).toBe(3)
    expect(spy).toHaveBeenCalledWith('uic', 'g')
    expect(regexp.lastIndex).toBe(6)
  })

  it('keeps constructor identity', () => {
    expect(createLazyRegExp('a', '').constructor).toBe(RegExp)
  })

  it('behaves like the compiled RegExp', () => {
    const regexp = createLazyRegExp('a(b)', 'g')

    expect(regexp.global).toBe(true)
    expect(regexp.ignoreCase).toBe(false)
    expect(regexp.toString()).toBe('/a(b)/g')
    expect(String(regexp)).toBe('/a(b)/g')
    expect(Object.prototype.toString.call(regexp)).toBe('[object RegExp]')
    expect('exec' in regexp).toBe(true)

    expect(regexp.exec('xab')?.[1]).toBe('b')
    expect(regexp.lastIndex).toBe(3)
    regexp.lastIndex = 0
    expect(regexp.lastIndex).toBe(0)

    expect('ab ab'.replace(regexp, '_')).toBe('_ _')
    expect('ab ab'.match(regexp)).toEqual(['ab', 'ab'])
    expect('xaby'.split(regexp)).toEqual(['x', 'b', 'y'])
    expect('xab'.search(regexp)).toBe(1)
    expect([...'ab ab'.matchAll(regexp)]).toHaveLength(2)

    expect(new RegExp(regexp).flags).toBe('g')
    expect(new RegExp(regexp, 'i').source).toBe('a(b)')
    expect(regexp).toEqual(/a(b)/g)
  })

  it('throws a SyntaxError on first use when the pattern is invalid', () => {
    const regexp = createLazyRegExp('(', '')
    expect(regexp).toBeInstanceOf(RegExp)
    expect(() => regexp.test('')).toThrow(SyntaxError)
    expect(() => regexp.source).toThrow(SyntaxError)
  })
})
