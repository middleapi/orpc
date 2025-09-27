import { toStandardUrl } from './url'

describe('toStandardUrl', () => {
  it('protocol', () => {
    expect(toStandardUrl({ headers: {}, socket: {} } as any).protocol).toEqual('http:')
    expect(toStandardUrl({ headers: {}, socket: { encrypted: true } } as any).protocol).toEqual('https:')
  })

  it('host', () => {
    expect(toStandardUrl({ headers: { host: 'example.com' }, socket: {} } as any).host).toEqual('example.com')
    expect(toStandardUrl({ headers: { }, socket: { encrypted: true } } as any).host).toEqual('localhost')
  })

  it('path', () => {
    expect(toStandardUrl({ headers: {}, socket: {} } as any).pathname).toEqual('/')
    expect(toStandardUrl({ url: '/', headers: {}, socket: {} } as any).pathname).toEqual('/')
    expect(toStandardUrl({ url: '/foo', headers: {}, socket: {} } as any).pathname).toEqual('/foo')
    expect(toStandardUrl({ url: '/foo/bar', headers: {}, socket: {} } as any).pathname).toEqual('/foo/bar')
    expect(toStandardUrl({ url: '/', originalUrl: '/foo/bar/baz', headers: {}, socket: {} } as any).pathname).toEqual('/foo/bar/baz')
  })

  it('malformed input', () => {
    expect(toStandardUrl({ headers: { host: ':::' }, socket: {}, url: '/hello' } as any).href).toEqual('http://localhost/hello')
    expect(toStandardUrl({ headers: { host: ':::' }, socket: { encrypted: true }, url: '/hello' } as any).href).toEqual('https://localhost/hello')

    expect(toStandardUrl({ headers: { host: 'test/test' }, socket: {}, url: '/hello' } as any).href).toEqual('http://test/hello')
    expect(toStandardUrl({ headers: { host: 'test/test' }, socket: { encrypted: true }, url: '/hello' } as any).href).toEqual('https://test/hello')

    expect(toStandardUrl({ headers: {}, socket: {}, url: '////' } as any).href).toEqual('http://localhost////')
    expect(toStandardUrl({ headers: {}, socket: {}, url: ':::' } as any).href).toEqual('http://localhost/:::')
  })
})
