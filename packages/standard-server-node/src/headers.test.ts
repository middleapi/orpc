import { toNodeHttpHeaders } from './headers'

describe('toNodeHttpHeaders', () => {
  it('filters out undefined values', () => {
    const headers = toNodeHttpHeaders({
      'x-custom': 'value',
      'x-undefined': undefined,
      'set-cookie': ['cookie1=value1', 'cookie2=value2'],
    })

    expect(headers).toEqual({
      'x-custom': 'value',
      'set-cookie': ['cookie1=value1', 'cookie2=value2'],
    })
    expect(headers).not.toHaveProperty('x-undefined')
  })
})
