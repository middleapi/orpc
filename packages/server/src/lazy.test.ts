import { Lazy, unlazy } from './lazy'

describe('lazy', () => {
  const meta = { title: 'test' }
  const loader = async () => ({ default: 'hello' })
  const lazy = new Lazy({ meta, loader })

  describe('instanceof', () => {
    it('support both instanceof and structural check', async () => {
      expect(lazy).toBeInstanceOf(Lazy)
      expect({ '~orpc': lazy['~orpc'] }).toBeInstanceOf(Lazy)

      expect(null).not.toBeInstanceOf(Lazy)
      expect(undefined).not.toBeInstanceOf(Lazy)
      expect({}).not.toBeInstanceOf(Lazy)
      expect({ '~orpc': {} }).not.toBeInstanceOf(Lazy)
      expect({ '~orpc': { ...lazy['~orpc'], meta: 'invalid' } }).not.toBeInstanceOf(Lazy)
      expect({ '~orpc': { ...lazy['~orpc'], loader: 'invalid' } }).not.toBeInstanceOf(Lazy)
      expect({ '~orpc': { ...lazy['~orpc'], metaPlugins: 'invalid' } }).not.toBeInstanceOf(Lazy)

      expect({
        '~orpc': {
          ...lazy['~orpc'],
          metaPlugins: [{ name: 'test', apply: () => {} }],
        },
      }).toBeInstanceOf(Lazy)
    })

    it('not support structural for extended class', () => {
      class ExtendedLazy extends Lazy<any> {}

      const extendedLazy = new ExtendedLazy({ meta, loader })

      expect(extendedLazy).toBeInstanceOf(Lazy)
      expect(extendedLazy).toBeInstanceOf(ExtendedLazy)

      expect({ '~orpc': extendedLazy['~orpc'] }).toBeInstanceOf(Lazy)
      expect({ '~orpc': extendedLazy['~orpc'] }).not.toBeInstanceOf(ExtendedLazy)
    })
  })
})

describe('unlazy', () => {
  it('with non-lazy value', async () => {
    const val = { foo: 'bar' }
    await expect(unlazy(val)).resolves.toEqual({ default: val })
  })

  it('with lazy value', async () => {
    const loader = vi.fn().mockResolvedValue({ default: 'hello' })
    const lazy = new Lazy({ meta: {}, loader })
    await expect(unlazy(lazy)).resolves.toEqual({ default: 'hello' })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('memoizes the result per lazy instance, including concurrent calls', async () => {
    const loader = vi.fn(async () => ({ default: {} }))
    const lazy = new Lazy({ meta: {}, loader })

    const [r1, r2] = await Promise.all([unlazy(lazy), unlazy(lazy)])
    const r3 = await unlazy(lazy)

    expect(r1.default).toBe(r2.default)
    expect(r3.default).toBe(r1.default)
    expect(loader).toHaveBeenCalledTimes(1)

    // another instance sharing the same definition is cached separately
    await unlazy({ '~orpc': lazy['~orpc'] } as typeof lazy)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not cache failed loads, so they can be retried', async () => {
    let attempts = 0
    const loader = vi.fn(() => {
      attempts++
      if (attempts === 1) {
        throw new Error('sync boom')
      }
      if (attempts === 2) {
        return Promise.reject(new Error('async boom'))
      }
      return Promise.resolve({ default: 'hello' })
    })
    const lazy = new Lazy({ meta: {}, loader })

    expect(() => unlazy(lazy)).toThrow('sync boom')
    await expect(unlazy(lazy)).rejects.toThrow('async boom')
    await expect(unlazy(lazy)).resolves.toEqual({ default: 'hello' })
    await expect(unlazy(lazy)).resolves.toEqual({ default: 'hello' })
    expect(loader).toHaveBeenCalledTimes(3)
  })
})
