import type { IncomingMessage, ServerResponse } from 'node:http'
import type { StaticFileHandlerPluginOptions } from './static-file-handler-plugin'
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { os } from '@orpc/server'
import { RPCHandler as FetchRPCHandler } from '@orpc/server/fetch'
import { RPCHandler } from '@orpc/server/node'
import request from 'supertest'
import { StaticFileHandlerPlugin } from './static-file-handler-plugin'

describe('staticFileHandlerPlugin', () => {
  let baseDir: string
  let rootDir: string
  let helloEtag: string
  let helloLastModified: string

  beforeAll(async () => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'orpc-static-file-'))
    rootDir = path.join(baseDir, 'public')
    mkdirSync(rootDir)

    // A file outside the root, so a successful traversal would serve real content
    writeFileSync(path.join(baseDir, 'secret.txt'), 'outside root')

    writeFileSync(path.join(rootDir, 'index.html'), '<h1>home</h1>')
    writeFileSync(path.join(rootDir, 'hello.txt'), 'hello world')
    writeFileSync(path.join(rootDir, 'data.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
    writeFileSync(path.join(rootDir, 'no-extension'), 'binary-ish')
    writeFileSync(path.join(rootDir, '.secret'), 'dotfile')
    writeFileSync(path.join(rootDir, 'empty.txt'), '')

    mkdirSync(path.join(rootDir, 'nested'))
    writeFileSync(path.join(rootDir, 'nested', 'index.html'), '<h1>nested</h1>')
    writeFileSync(path.join(rootDir, 'nested', 'style.css'), 'body{}')

    mkdirSync(path.join(rootDir, 'no-index'))
    writeFileSync(path.join(rootDir, 'no-index', 'file.txt'), 'inside')

    writeFileSync(path.join(rootDir, 'compressed.txt'), 'identity content')
    writeFileSync(path.join(rootDir, 'compressed.txt.gz'), gzipSync('gzip content'))
    writeFileSync(path.join(rootDir, 'compressed.txt.br'), brotliCompressSync('br content'))
    writeFileSync(path.join(rootDir, 'compressed.bin'), 'binary identity')
    writeFileSync(path.join(rootDir, 'compressed.bin.gz'), gzipSync('binary gzip'))

    const res = await createStaticAgent().get('/hello.txt')
    helloEtag = res.headers.etag!
    helloLastModified = res.headers['last-modified']!
  })

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function createAgent(handler: RPCHandler<Record<never, never>>, options: { prefix?: `/${string}` } = {}) {
    return request(async (req: IncomingMessage, response: ServerResponse) => {
      const result = await handler.handle(req as any, response as any, { context: {}, ...options })

      if (!result.matched) {
        response.statusCode = 404
        response.end('not matched')
      }
    })
  }

  function createStaticAgent(pluginOptions: Partial<StaticFileHandlerPluginOptions> = {}, handleOptions: { prefix?: `/${string}` } = {}) {
    const handler = new RPCHandler({}, {
      plugins: [new StaticFileHandlerPlugin({ rootDir, ...pluginOptions })],
    })

    return createAgent(handler, handleOptions)
  }

  it('serves a file with standard headers', async () => {
    const res = await createStaticAgent().get('/hello.txt')

    expect(res.status).toBe(200)
    expect(res.text).toBe('hello world')
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-length']).toBe('11')
    expect(res.headers['cache-control']).toBe('public, max-age=0')
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers.etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/)
    expect(res.headers['last-modified']).toBe(statSync(path.join(rootDir, 'hello.txt')).mtime.toUTCString())
    // Guards against a Blob body, which would make the adapter attach a content-disposition
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  it('serves an empty file', async () => {
    const res = await createStaticAgent().get('/empty.txt')

    expect(res.status).toBe(200)
    expect(res.text).toBe('')
    expect(res.headers['content-length']).toBe('0')
  })

  it('serves unknown extensions as application/octet-stream', async () => {
    const res = await createStaticAgent().get('/no-extension')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/octet-stream')
  })

  it('does not resolve content types through the prototype chain', async () => {
    writeFileSync(path.join(rootDir, 'file.constructor'), 'x')
    writeFileSync(path.join(rootDir, 'file.__proto__'), 'x')

    const agent = createStaticAgent()

    for (const url of ['/file.constructor', '/file.__proto__']) {
      const res = await agent.get(url)
      expect(res.status, url).toBe(200)
      expect(res.headers['content-type'], url).toBe('application/octet-stream')
    }
  })

  it('supports custom cache control and mime types', async () => {
    const agent = createStaticAgent({
      cacheControl: 'public, max-age=31536000, immutable',
      mimeTypes: { txt: 'text/x-custom' },
    })

    const res = await agent.get('/hello.txt')

    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.headers['content-type']).toBe('text/x-custom')
  })

  it('omits cache-control when disabled', async () => {
    const res = await createStaticAgent({ cacheControl: false }).get('/hello.txt')

    expect(res.headers['cache-control']).toBeUndefined()
  })

  it('falls through when no file matches', async () => {
    const res = await createStaticAgent().get('/missing.txt')

    expect(res.status).toBe(404)
    expect(res.text).toBe('not matched')
  })

  it('ignores non-GET/HEAD requests', async () => {
    const res = await createStaticAgent().post('/hello.txt')

    expect(res.status).toBe(404)
    expect(res.text).toBe('not matched')
  })

  it('prefers matched procedures over files', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    }, {
      allowMethods: ['GET'],
      plugins: [new StaticFileHandlerPlugin({ rootDir })],
    })

    writeFileSync(path.join(rootDir, 'ping'), 'file content')

    const res = await createAgent(handler).get(`/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`)

    expect(res.status).toBe(200)
    expect(res.text).toContain('pong')
  })

  describe('head requests', () => {
    it('sends headers without a body', async () => {
      const res = await createStaticAgent().head('/hello.txt')

      expect(res.status).toBe(200)
      expect(res.text).toBeUndefined()
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
      expect(res.headers['content-length']).toBe('11')
      expect(res.headers.etag).toMatch(/^W\//)
    })

    it('ignores range headers', async () => {
      const res = await createStaticAgent().head('/data.bin').set('range', 'bytes=0-3')

      expect(res.status).toBe(200)
      expect(res.headers['content-length']).toBe('10')
    })
  })

  describe('conditional requests', () => {
    it('responds 304 when if-none-match matches', async () => {
      const res = await createStaticAgent().get('/hello.txt').set('if-none-match', helloEtag)

      expect(res.status).toBe(304)
      expect(res.text).toBe('')
      expect(res.headers.etag).toBe(helloEtag)
      expect(res.headers['content-type']).toBeUndefined()
      expect(res.headers['content-length']).toBeUndefined()
    })

    it('responds 304 when if-none-match contains the etag in a list or is a wildcard', async () => {
      const agent = createStaticAgent()

      const listRes = await agent.get('/hello.txt').set('if-none-match', `"other", ${helloEtag}`)
      expect(listRes.status).toBe(304)

      const wildcardRes = await agent.get('/hello.txt').set('if-none-match', '*')
      expect(wildcardRes.status).toBe(304)
    })

    it('responds 200 when if-none-match does not match', async () => {
      const res = await createStaticAgent().get('/hello.txt').set('if-none-match', '"different"')

      expect(res.status).toBe(200)
      expect(res.text).toBe('hello world')
    })

    it('responds 304 when not modified since if-modified-since', async () => {
      const res = await createStaticAgent().get('/hello.txt').set('if-modified-since', helloLastModified)

      expect(res.status).toBe(304)
    })

    it('responds 200 when modified after if-modified-since', async () => {
      const past = new Date(Date.now() - 100_000_000).toUTCString()
      const res = await createStaticAgent().get('/hello.txt').set('if-modified-since', past)

      expect(res.status).toBe(200)
    })

    it('if-none-match takes precedence over if-modified-since', async () => {
      const res = await createStaticAgent().get('/hello.txt').set('if-none-match', '"different"').set('if-modified-since', helloLastModified)

      expect(res.status).toBe(200)
    })

    it('revalidates to 304 even when the client sends cache-control no-cache, like fetch does', async () => {
      const res = await createStaticAgent().get('/hello.txt').set('if-none-match', helloEtag).set('cache-control', 'no-cache')

      expect(res.status).toBe(304)
    })
  })

  describe('range requests', () => {
    it('serves a partial response', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=2-5')

      expect(res.status).toBe(206)
      expect(res.headers['content-range']).toBe('bytes 2-5/10')
      expect(res.headers['content-length']).toBe('4')
      expect(res.body).toEqual(Buffer.from([2, 3, 4, 5]))
    })

    it('serves an open-ended range', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=7-')

      expect(res.status).toBe(206)
      expect(res.headers['content-range']).toBe('bytes 7-9/10')
      expect(res.body).toEqual(Buffer.from([7, 8, 9]))
    })

    it('serves a suffix range', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=-3')

      expect(res.status).toBe(206)
      expect(res.headers['content-range']).toBe('bytes 7-9/10')
      expect(res.body).toEqual(Buffer.from([7, 8, 9]))
    })

    it('clamps ranges past the end of the file', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=8-100')

      expect(res.status).toBe(206)
      expect(res.headers['content-range']).toBe('bytes 8-9/10')
    })

    it('responds 416 when the range is unsatisfiable', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=100-')

      expect(res.status).toBe(416)
      expect(res.headers['content-range']).toBe('bytes */10')
    })

    it('ignores malformed and multi-range headers', async () => {
      const agent = createStaticAgent()

      const malformedRes = await agent.get('/data.bin').set('range', 'bytes=abc')
      expect(malformedRes.status).toBe(200)

      const multiRes = await agent.get('/data.bin').set('range', 'bytes=0-1,3-4')
      expect(multiRes.status).toBe(200)

      const invertedRes = await agent.get('/data.bin').set('range', 'bytes=5-2')
      expect(invertedRes.status).toBe(200)
    })

    it('ignores the range when if-range does not match', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=0-3').set('if-range', new Date(Date.now() - 100_000_000).toUTCString())

      expect(res.status).toBe(200)
      expect(res.headers['content-length']).toBe('10')
    })

    it('applies the range when if-range matches the last modified date', async () => {
      const res = await createStaticAgent().get('/data.bin').set('range', 'bytes=0-3').set('if-range', statSync(path.join(rootDir, 'data.bin')).mtime.toUTCString())

      expect(res.status).toBe(206)
    })
  })

  describe('directories and index files', () => {
    it('serves the index file for the root path', async () => {
      const res = await createStaticAgent().get('/')

      expect(res.status).toBe(200)
      expect(res.text).toBe('<h1>home</h1>')
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    })

    it('serves the index file of a nested directory', async () => {
      const res = await createStaticAgent().get('/nested/')

      expect(res.status).toBe(200)
      expect(res.text).toBe('<h1>nested</h1>')
    })

    it('redirects directories without a trailing slash, preserving the query', async () => {
      const res = await createStaticAgent().get('/nested?foo=bar')

      expect(res.status).toBe(301)
      expect(res.headers.location).toBe('/nested/?foo=bar')
    })

    it('falls through when the directory has no index file', async () => {
      const res = await createStaticAgent().get('/no-index/')

      expect(res.status).toBe(404)
    })

    it('supports disabling index files', async () => {
      const res = await createStaticAgent({ indexFile: false }).get('/nested/')

      expect(res.status).toBe(404)
    })

    it('supports a custom index file', async () => {
      const res = await createStaticAgent({ indexFile: 'file.txt' }).get('/no-index/')

      expect(res.status).toBe(200)
      expect(res.text).toBe('inside')
    })
  })

  describe('security', () => {
    it('blocks directory traversal', async () => {
      const agent = createStaticAgent()

      const urls = [
        '/../secret.txt',
        '/%2e%2e/secret.txt',
        '/%2E%2E/secret.txt',
        '/..%2fsecret.txt',
        '/%2e%2e%2fsecret.txt',
        '/%252e%252e/secret.txt',
        '/..%c0%af/secret.txt',
        '/nested/%2e%2e/%2e%2e/secret.txt',
        '/foo%5c..%5cbar.txt',
        '/foo%2fbar.txt',
      ]

      for (const url of urls) {
        const res = await agent.get(url)
        expect(res.status, url).toBe(404)
        expect(res.text, url).toBe('not matched')
      }
    })

    it('resolves dot segments within the root instead of following them', async () => {
      const agent = createStaticAgent()

      const inside = await agent.get('/nested/%2e%2e/hello.txt')
      expect(inside.status).toBe(200)
      expect(inside.text).toBe('hello world')

      const clamped = await agent.get('/%2e%2e/%2e%2e/%2e%2e/hello.txt')
      expect(clamped.status).toBe(200)
      expect(clamped.text).toBe('hello world')
    })

    it('never serves index or fallback files that escape the root', async () => {
      const indexRes = await createStaticAgent({ indexFile: '../secret.txt' }).get('/')
      expect(indexRes.status).toBe(404)

      const fallbackRes = await createStaticAgent({ fallbackFile: '../secret.txt' }).get('/missing.txt')
      expect(fallbackRes.status).toBe(404)
    })

    it('rejects paths containing null bytes', async () => {
      const res = await createStaticAgent().get('/hello.txt%00.png')

      expect(res.status).toBe(404)
    })

    it('hides dotfiles by default and serves them when enabled', async () => {
      const hiddenRes = await createStaticAgent().get('/.secret')
      expect(hiddenRes.status).toBe(404)

      const allowedRes = await createStaticAgent({ dotfiles: true }).get('/.secret')
      expect(allowedRes.status).toBe(200)
      expect(allowedRes.body).toEqual(Buffer.from('dotfile'))
    })
  })

  describe('mounting', () => {
    it('serves files under a custom path', async () => {
      const agent = createStaticAgent({ path: '/assets' })

      const res = await agent.get('/assets/hello.txt')
      expect(res.status).toBe(200)
      expect(res.text).toBe('hello world')

      const outsideRes = await agent.get('/hello.txt')
      expect(outsideRes.status).toBe(404)

      const partialPrefixRes = await agent.get('/assetshello.txt')
      expect(partialPrefixRes.status).toBe(404)
    })

    it('serves files under the handler prefix', async () => {
      const agent = createStaticAgent({}, { prefix: '/api' })

      const res = await agent.get('/api/hello.txt')
      expect(res.status).toBe(200)
      expect(res.text).toBe('hello world')
    })

    it('combines the handler prefix and the path option', async () => {
      const agent = createStaticAgent({ path: '/assets' }, { prefix: '/api' })

      const res = await agent.get('/api/assets/hello.txt')
      expect(res.status).toBe(200)

      const outsideRes = await agent.get('/api/hello.txt')
      expect(outsideRes.status).toBe(404)
    })

    it('redirects a mounted directory path without a trailing slash', async () => {
      const res = await createStaticAgent({ path: '/assets' }).get('/assets')

      expect(res.status).toBe(301)
      expect(res.headers.location).toBe('/assets/')
    })
  })

  describe('precompressed', () => {
    it('serves the precompressed variant when the client accepts its encoding', async () => {
      const res = await createStaticAgent({ precompressed: true })
        .get('/compressed.txt')
        .set('accept-encoding', 'gzip')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(res.headers.vary).toBe('accept-encoding')
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
      expect(res.text).toBe('gzip content')
    })

    it('prefers brotli over gzip and ignores q-value parameters', async () => {
      const res = await createStaticAgent({ precompressed: true })
        .get('/compressed.txt')
        .set('accept-encoding', 'gzip;q=0.8, br;q=0.9')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBe('br')
      expect(res.text).toBe('br content')
    })

    it('serves the identity variant with vary when no encoding is accepted', async () => {
      const res = await createStaticAgent({ precompressed: true })
        .get('/compressed.txt')
        .set('accept-encoding', 'identity')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBe('accept-encoding')
      expect(res.text).toBe('identity content')
    })

    it('is disabled by default', async () => {
      const res = await createStaticAgent()
        .get('/compressed.txt')
        .set('accept-encoding', 'gzip')

      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBeUndefined()
      expect(res.text).toBe('identity content')
    })

    it('does not apply to non-compressible content types', async () => {
      const res = await createStaticAgent({ precompressed: true })
        .get('/compressed.bin')
        .set('accept-encoding', 'gzip')

      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBeUndefined()
      expect(res.body).toEqual(Buffer.from('binary identity'))
    })
  })

  describe('fallback file', () => {
    it('serves the fallback file when nothing matches', async () => {
      const res = await createStaticAgent({ fallbackFile: 'index.html' }).get('/some/spa/route')

      expect(res.status).toBe(200)
      expect(res.text).toBe('<h1>home</h1>')
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    })

    it('still serves existing files over the fallback', async () => {
      const res = await createStaticAgent({ fallbackFile: 'index.html' }).get('/hello.txt')

      expect(res.status).toBe(200)
      expect(res.text).toBe('hello world')
    })
  })

  it('handles files modified in the past consistently', async () => {
    const filePath = path.join(rootDir, 'old.txt')
    writeFileSync(filePath, 'old content')
    const past = new Date('2020-01-02T03:04:05Z')
    utimesSync(filePath, past, past)

    const agent = createStaticAgent()
    const res = await agent.get('/old.txt')

    expect(res.status).toBe(200)
    expect(res.headers['last-modified']).toBe(past.toUTCString())

    const freshRes = await agent.get('/old.txt').set('if-modified-since', past.toUTCString())
    expect(freshRes.status).toBe(304)
  })

  /**
   * The plugin is adapter agnostic, these smoke tests only prove the fetch
   * adapter wiring; the http semantics are covered by the suites above.
   */
  describe('fetch adapter', () => {
    it('serves a file and falls through when no file matches', async () => {
      const handler = new FetchRPCHandler({}, {
        plugins: [new StaticFileHandlerPlugin({ rootDir })],
      })

      const served = await handler.handle(new Request('https://example.com/hello.txt'))
      expect(served.matched).toBe(true)
      expect(served.response!.status).toBe(200)
      expect(await served.response!.text()).toBe('hello world')
      expect(served.response!.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(served.response!.headers.get('etag')).toBe(helloEtag)

      const unmatched = await handler.handle(new Request('https://example.com/missing.txt'))
      expect(unmatched.matched).toBe(false)
    })
  })
})
