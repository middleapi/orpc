import { Lazy, memoizeLoader, unlazy } from './lazy'

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
})

describe('memoizeLoader', () => {
  it('runs the loader once and shares the in-flight and resolved promise', async () => {
    const loader = vi.fn(async () => ({ default: { value: 'hello' } }))
    const memoized = memoizeLoader(loader)

    expect(loader).not.toHaveBeenCalled()

    const [first, second] = await Promise.all([memoized(), memoized()])
    const third = await memoized()

    expect(first).toEqual({ default: { value: 'hello' } })
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('does not cache a rejected load so it can be retried', async () => {
    const error = new Error('failed to load')
    const loader = vi.fn(async () => ({ default: { value: 'hello' } }))
    loader.mockRejectedValueOnce(error)
    const memoized = memoizeLoader(loader)

    const [failed1, failed2] = await Promise.allSettled([memoized(), memoized()])
    expect(failed1).toEqual({ status: 'rejected', reason: error })
    expect(failed2).toEqual({ status: 'rejected', reason: error })
    expect(loader).toHaveBeenCalledTimes(1)

    const first = await memoized()
    const second = await memoized()

    expect(first).toEqual({ default: { value: 'hello' } })
    expect(second).toBe(first)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('shares the cache with structural copies of a lazy', async () => {
    const loader = vi.fn(async () => ({ default: 'hello' }))
    const lazy = new Lazy({ meta: {}, loader: memoizeLoader(loader) })

    const first = await unlazy(lazy)
    const second = await unlazy(new Lazy({ ...lazy['~orpc'] }))
    const third = await lazy['~orpc'].loader()

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
