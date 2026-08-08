import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standardserver/core'
import type { Stats } from 'node:fs'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { getOpenTelemetryConfig, isCompressibleContentType, matchesHttpPathPrefix, mergeHttpPath, parseAcceptEncodings, toArray, tryDecodeURIComponent } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standardserver/core'

const DEFAULT_MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
  gz: 'application/gzip',
}

const PRECOMPRESSED_ENCODINGS: [encoding: string, extension: string][] = [
  ['br', '.br'],
  ['zstd', '.zst'],
  ['gzip', '.gz'],
]

export interface StaticFileHandlerPluginOptions {
  /**
   * The directory files are served from. Resolved against the working
   * directory when relative.
   */
  rootDir: string

  /**
   * The URL path files are served under, appended to the handler prefix
   * when one is set.
   *
   * @default '/'
   */
  path?: `/${string}`

  /**
   * The file served when the request path resolves to a directory.
   * Set to `false` to disable directory index files.
   *
   * @default 'index.html'
   */
  indexFile?: string | false

  /**
   * A file served with status 200 when no file matches the request path,
   * relative to `rootDir`. Useful for single-page application routing.
   *
   * @default undefined
   */
  fallbackFile?: string

  /**
   * The `Cache-Control` response header value. Set to `false` to omit the header.
   *
   * @default 'public, max-age=0'
   */
  cacheControl?: string | false

  /**
   * Whether files and directories whose name starts with a dot can be served.
   *
   * @default false
   */
  dotfiles?: boolean

  /**
   * Whether precompressed sidecar files (`.br`, `.zst`, `.gz`) can be served
   * when the client accepts their encoding and the content type is compressible.
   *
   * @default false
   */
  precompressed?: boolean

  /**
   * Extra content types keyed by lowercase file extension without the dot,
   * merged over the built-in mapping. Unknown extensions are served as
   * `application/octet-stream`.
   */
  mimeTypes?: Record<string, string>
}

/**
 * Serves static files from a directory with standard HTTP semantics:
 * `ETag`/`Last-Modified` conditional requests, range requests, index files,
 * and directory traversal protection. Files are served as a fallback,
 * so matched procedures always win.
 *
 * @see {@link https://orpc.dev/docs/plugins/static-file | Static File Plugin}
 */
export class StaticFileHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~static-file'

  /**
   * Ensure the OpenTelemetry span is available when the interceptor renames it.
   */
  after = ['~opentelemetry']

  private readonly rootDir: string
  /** `rootDir` with a trailing separator, precomputed for the containment check. */
  private readonly rootDirPrefix: string
  private readonly path: Exclude<StaticFileHandlerPluginOptions['path'], undefined>
  private readonly indexFile: Exclude<StaticFileHandlerPluginOptions['indexFile'], undefined>
  private readonly fallbackFile: StaticFileHandlerPluginOptions['fallbackFile']
  private readonly cacheControl: Exclude<StaticFileHandlerPluginOptions['cacheControl'], undefined>
  private readonly dotfiles: Exclude<StaticFileHandlerPluginOptions['dotfiles'], undefined>
  private readonly precompressed: Exclude<StaticFileHandlerPluginOptions['precompressed'], undefined>
  private readonly mimeTypes: Exclude<StaticFileHandlerPluginOptions['mimeTypes'], undefined>

  constructor(options: StaticFileHandlerPluginOptions) {
    this.rootDir = path.resolve(options.rootDir)
    this.rootDirPrefix = this.rootDir.endsWith(path.sep) ? this.rootDir : this.rootDir + path.sep
    const basePath = options.path ?? '/'
    this.path = basePath.length > 1 && basePath.endsWith('/') ? basePath.slice(0, -1) as `/${string}` : basePath
    this.indexFile = options.indexFile ?? 'index.html'
    this.fallbackFile = options.fallbackFile
    this.cacheControl = options.cacheControl ?? 'public, max-age=0'
    this.dotfiles = options.dotfiles ?? false
    this.precompressed = options.precompressed ?? false
    // A null prototype prevents extensions like "constructor" from resolving through the prototype chain
    this.mimeTypes = Object.assign(Object.create(null) as Record<string, string>, DEFAULT_MIME_TYPES, options.mimeTypes)
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, request, prefix }) => {
      const result = await next()

      if (result.matched || (request.method !== 'GET' && request.method !== 'HEAD')) {
        return result
      }

      const base = this.resolveBasePath(prefix)
      const response = await this.serve(request, base)

      if (response === undefined) {
        return result
      }

      /**
       * The request url is excluded because span names should have low cardinality,
       * so only the configured base path is used.
       */
      getOpenTelemetryConfig()?.trace.getActiveSpan()?.updateName(`${request.method} ${base === '/' ? '' : base}/* (static file)`)

      return { matched: true, response }
    }

    return {
      ...options,
      // Run after user-provided routing interceptors so they can capture file responses
      routingInterceptors: [...toArray(options.routingInterceptors), routingInterceptor],
    }
  }

  /**
   * Joins segments under `rootDir` and guarantees the result cannot escape it,
   * as a second layer of defense after URL segment validation.
   */
  private resolveWithinRoot(segments: string[]): string | undefined {
    const resolved = path.join(this.rootDir, ...segments)

    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDirPrefix)) {
      return undefined
    }

    return resolved
  }

  private resolveBasePath(prefix: `/${string}` | undefined): `/${string}` {
    if (prefix === undefined) {
      return this.path
    }

    const base = mergeHttpPath(prefix, this.path)
    return base.length > 1 && base.endsWith('/') ? base.slice(0, -1) as `/${string}` : base
  }

  /**
   * Resolves segments under `rootDir` and stats the result,
   * `resolveWithinRoot` guarantees nothing outside the root is ever touched.
   */
  private async lookup(segments: string[]): Promise<[filePath: string, stats: Stats] | undefined> {
    const filePath = this.resolveWithinRoot(segments)

    if (filePath === undefined) {
      return undefined
    }

    const stats = await stat(filePath).catch(() => undefined)
    return stats === undefined ? undefined : [filePath, stats]
  }

  private async serve(request: StandardLazyRequest, base: `/${string}`): Promise<StandardResponse | undefined> {
    const [pathname, search] = parseStandardUrl(request.url)

    if (base !== '/' && !matchesHttpPathPrefix(pathname, base)) {
      return undefined
    }

    const segments: string[] = []
    for (const rawSegment of pathname.slice(base.length).split('/')) {
      const segment = rawSegment.includes('%') ? tryDecodeURIComponent(rawSegment) : rawSegment

      if (segment === '' || segment === '.') {
        continue
      }

      // Dot segments are resolved in url space and clamped at the root, so they can never escape it
      if (segment === '..') {
        segments.pop()
        continue
      }

      if (segment.includes('\0') || segment.includes('/') || segment.includes('\\')) {
        return undefined
      }

      if (!this.dotfiles && segment.startsWith('.')) {
        return undefined
      }

      segments.push(segment)
    }

    let found = await this.lookup(segments)

    if (found?.[1].isDirectory()) {
      if (this.indexFile === false) {
        found = undefined
      }
      else if (!pathname.endsWith('/')) {
        // Redirect so relative links inside the index file resolve correctly
        return { status: 301, headers: { location: `${pathname}/${search ?? ''}` } }
      }
      else {
        found = await this.lookup([...segments, this.indexFile])
      }
    }

    if (found === undefined || !found[1].isFile()) {
      if (this.fallbackFile === undefined) {
        return undefined
      }

      found = await this.lookup([this.fallbackFile])

      if (found === undefined || !found[1].isFile()) {
        return undefined
      }
    }

    let [filePath, stats] = found

    const contentType = this.mimeTypes[path.extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream'
    const negotiatesEncoding = this.precompressed && isCompressibleContentType(contentType)

    let contentEncoding: string | undefined

    if (negotiatesEncoding) {
      const acceptedEncodings = new Set(parseAcceptEncodings(flattenStandardHeader(request.headers['accept-encoding'])))
      const candidates = PRECOMPRESSED_ENCODINGS.filter(([encoding]) => acceptedEncodings.has(encoding))
      const candidateStats = await Promise.all(candidates.map(([, extension]) => stat(filePath + extension).catch(() => undefined)))

      for (let i = 0; i < candidates.length; i++) {
        if (candidateStats[i]?.isFile()) {
          filePath += candidates[i]![1]
          stats = candidateStats[i]!
          contentEncoding = candidates[i]![0]
          break
        }
      }
    }

    const size = stats.size
    const etag = `W/"${size.toString(16)}-${stats.mtime.getTime().toString(16)}"`
    const lastModified = stats.mtime.toUTCString()
    // Truncated to seconds, matching the precision of http dates
    const lastModifiedTime = Math.floor(stats.mtime.getTime() / 1000) * 1000

    const headers: StandardHeaders = {
      'etag': etag,
      'last-modified': lastModified,
      'accept-ranges': 'bytes',
    }

    if (negotiatesEncoding) {
      // Sent even for the identity variant, so caches key on the encoding
      headers.vary = 'accept-encoding'
    }

    if (contentEncoding !== undefined) {
      headers['content-encoding'] = contentEncoding
    }

    if (this.cacheControl !== false) {
      headers['cache-control'] = this.cacheControl
    }

    if (isRequestFresh(request.headers, etag, lastModifiedTime)) {
      return { status: 304, headers }
    }

    let status = 200
    let start = 0
    let end = size - 1

    const range = request.method === 'GET' ? flattenStandardHeader(request.headers.range) : undefined

    if (range !== undefined && isRangeApplicable(request.headers, lastModifiedTime)) {
      const parsed = parseByteRange(range, size)

      if (parsed === 'unsatisfiable') {
        return { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } }
      }

      if (parsed !== undefined) {
        status = 206
        ;[start, end] = parsed
        headers['content-range'] = `bytes ${start}-${end}/${size}`
      }
    }

    headers['content-type'] = contentType
    headers['content-length'] = String(end - start + 1)

    /**
     * A HEAD response uses an empty stream instead of no body, because
     * the adapters strip the content headers when the body is `undefined`.
     */
    const body: ReadableStream<Uint8Array<ArrayBuffer>> = request.method === 'HEAD'
      ? new ReadableStream({ start: controller => controller.close() })
      : Readable.toWeb(status === 206 ? createReadStream(filePath, { start, end }) : createReadStream(filePath)) as ReadableStream<Uint8Array<ArrayBuffer>>

    return { status, headers, body }
  }
}

function stripWeakEtagPrefix(etag: string): string {
  return etag.startsWith('W/') ? etag.slice(2) : etag
}

/**
 * A request `Cache-Control: no-cache` directive is deliberately not considered:
 * it asks for validation with the origin and a `304` is a successful validation.
 * `fetch` even sends it alongside its conditional headers.
 */
function isRequestFresh(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number): boolean {
  const ifNoneMatch = flattenStandardHeader(requestHeaders['if-none-match'])
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch.trim() === '*') {
      return true
    }

    const bareEtag = stripWeakEtagPrefix(etag)
    return ifNoneMatch.split(',').some(tag => stripWeakEtagPrefix(tag.trim()) === bareEtag)
  }

  const ifModifiedSince = flattenStandardHeader(requestHeaders['if-modified-since'])
  if (ifModifiedSince !== undefined) {
    const sinceTime = Date.parse(ifModifiedSince)
    return !Number.isNaN(sinceTime) && lastModifiedTime <= sinceTime
  }

  return false
}

function isRangeApplicable(requestHeaders: StandardHeaders, lastModifiedTime: number): boolean {
  const ifRange = flattenStandardHeader(requestHeaders['if-range'])

  if (ifRange === undefined) {
    return true
  }

  /**
   * The etag form requires a strong comparison and generated etags
   * are always weak, so it can never match.
   */
  if (ifRange.startsWith('"') || ifRange.startsWith('W/')) {
    return false
  }

  return Date.parse(ifRange) === lastModifiedTime
}

function parseByteRange(range: string, size: number): [start: number, end: number] | 'unsatisfiable' | undefined {
  const match = range.match(/^bytes=(\d*)-(\d*)$/)

  // Malformed and multi-range headers are ignored, serving the full file
  if (match === null || (match[1] === '' && match[2] === '')) {
    return undefined
  }

  if (match[1] === '') {
    const suffixLength = Number(match[2])

    if (suffixLength === 0 || size === 0) {
      return 'unsatisfiable'
    }

    return [Math.max(0, size - suffixLength), size - 1]
  }

  const start = Number(match[1])

  if (start >= size) {
    return 'unsatisfiable'
  }

  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)

  // An end before the start makes the range invalid, so it is ignored
  if (end < start) {
    return undefined
  }

  return [start, end]
}
