import { defer, once, tryOrUndefined } from './function'

it('once', () => {
  const fn = vi.fn(() => ({}))
  const onceFn = once(fn)

  expect(onceFn()).toBe(fn.mock.results[0]!.value)
  expect(onceFn()).toBe(fn.mock.results[0]!.value)
  expect(onceFn()).toBe(fn.mock.results[0]!.value)
  expect(onceFn()).toBe(fn.mock.results[0]!.value)
  expect(onceFn()).toBe(fn.mock.results[0]!.value)

  expect(fn).toHaveBeenCalledTimes(1)
})

describe('defer', () => {
  it('with setTimeout', async () => {
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    defer(callback1)
    callback2()

    expect(callback1).toHaveBeenCalledTimes(0)

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(callback1).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledBefore(callback1)
  })

  it('without setTimeout', async () => {
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    const originalSetTimeout = globalThis.setTimeout
    ;(globalThis as any).setTimeout = undefined
    defer(callback1)
    globalThis.setTimeout = originalSetTimeout
    callback2()

    expect(callback1).toHaveBeenCalledTimes(0)

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(callback1).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledBefore(callback1)
  })
})

describe('tryOrUndefined', () => {
  it('returns the result', () => {
    expect(tryOrUndefined(() => 123)).toBe(123)
  })

  it('returns undefined on throw', () => {
    expect(tryOrUndefined(() => {
      throw new Error('TEST')
    })).toBeUndefined()
  })

  it('preserves falsy values', () => {
    expect(tryOrUndefined(() => false)).toBe(false)
    expect(tryOrUndefined(() => 0)).toBe(0)
    expect(tryOrUndefined(() => '')).toBe('')
    expect(tryOrUndefined(() => null)).toBeNull()
  })
})
