import { getPathMeta, meta } from './meta-built-in'

describe('meta.path', () => {
  it('returns plugin with correct name', () => {
    const plugin = meta.path(['users', 'list'])
    expect(plugin.name).toBe('~path')
  })

  it('init merges ~path into existing meta', () => {
    const plugin = meta.path(['users', 'list'])
    const result = plugin.init!({ existing: true } as any)
    expect(result).toEqual({ 'existing': true, '~path': ['users', 'list'] })
  })

  it('init overwrites existing ~path', () => {
    const plugin = meta.path(['new'])
    const result = plugin.init!({ '~path': ['old'] } as any)
    expect(result).toEqual({ '~path': ['new'] })
  })

  it('init does not mutate the original meta', () => {
    const plugin = meta.path(['a'])
    const original = { x: 1 } as any
    const result = plugin.init!(original)
    expect(result).not.toBe(original)
  })
})

describe('getPathMeta', () => {
  it('returns the path from meta', () => {
    const input = { '~orpc': { meta: { '~path': ['a', 'b'] } } }
    expect(getPathMeta(input as any)).toEqual(['a', 'b'])
  })

  it('returns undefined when ~path is not set', () => {
    const input = { '~orpc': { meta: {} } }
    expect(getPathMeta(input as any)).toBeUndefined()
  })
})
