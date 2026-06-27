import { compileUriTemplate } from './uri-template'

describe('compileUriTemplate', () => {
  it('extracts a single variable and matches a concrete URI', () => {
    const t = compileUriTemplate('planet://{id}')
    expect(t.template).toBe('planet://{id}')
    expect(t.variables).toEqual(['id'])
    expect(t.match('planet://earth')).toEqual({ id: 'earth' })
    expect(t.match('other://x')).toBeUndefined()
  })

  it('extracts multiple variables across segments', () => {
    const t = compileUriTemplate('a://{x}/{y}')
    expect(t.variables).toEqual(['x', 'y'])
    expect(t.match('a://1/2')).toEqual({ x: '1', y: '2' })
    expect(t.match('a://1')).toBeUndefined()
  })

  it('matches a static URI exactly with no variables', () => {
    const t = compileUriTemplate('config://app')
    expect(t.variables).toEqual([])
    expect(t.match('config://app')).toEqual({})
    expect(t.match('config://other')).toBeUndefined()
  })

  it('uRL-decodes extracted variable values', () => {
    const t = compileUriTemplate('doc://{name}')
    expect(t.match('doc://a%20b')).toEqual({ name: 'a b' })
  })

  it('matches a single segment only (a variable does not span "/")', () => {
    const t = compileUriTemplate('p://{id}')
    expect(t.match('p://a/b')).toBeUndefined()
    expect(t.match('p://a')).toEqual({ id: 'a' })
  })
})
