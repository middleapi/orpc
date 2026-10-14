import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { Stats } from 'node:fs'
import type { Transform } from 'node:stream'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
// A namespace import, since a named import of `createZstdCompress` fails to load before Node.js 22.15
import * as zlib from 'node:zlib'
import { getTracer, isAcceptableEncoding, isCompressibleContentType, matchesHttpPathPrefix, mergeHttpPath, parseAcceptEncodingQualities, safeDecodeURIComponent, safeEncodeURIComponent, toArray } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standard-server/core'
import { toWebReadableStream } from '@standard-server/node'
import mime from 'mime'

/**
 * `mime` returns bare types, and http defines no default charset. A text response without one
 * is left to the html encoding sniffing algorithm, whose final fallback is the user's locale,
 * so text is pinned to utf-8. Binary types need no charset, and `application/json` is always
 * utf-8 by definition, where the parameter is undefined rather than merely redundant.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8259#section-11
 * @see https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding
 */
const TEXT_CONTENT_TYPE_REGEX = /^text\//

/**
 * NTFS and FAT give every name that breaks 8.3 rules, a leading dot included, a short alias that
 * opens the same entry, so `ENV~1` reads `.env` and `GIT~1/config` reads `.git/config` on any OS.
 * A generated alias ends its base of at most eight characters with a `~` numeric tail, and only
 * that prefix is matched, so suffixes the filesystem strips or ignores, like a trailing dot or a
 * `::$DATA` stream, are covered too. Linux vfat mounted with `nonumtail` drops the tail when it
 * can, and such an alias cannot be told apart from a real name, so that mount is not covered.
 *
 * @see https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#short-vs-long-names
 */
const SHORT_NAME_ALIAS_REGEX = /^[^.]{0,6}~\d/

type ContentEncoding = 'br' | 'zstd' | 'gzip'

const CONTENT_ENCODING_EXTENSIONS: Record<ContentEncoding, string> = {
  br: '.br',
  zstd: '.zst',
  gzip: '.gz',
}

/** Sidecars in order of preference, best compression first. */
const PRECOMPRESSED_ENCODINGS: readonly ContentEncoding[] = ['br', 'zstd', 'gzip']

interface EncodedFile {
  encoding: ContentEncoding
  filePath: string
  stats: Stats
}

export interface StaticFileHandlerPluginCompressionCacheOptions {
  /**
   * The directory compressed copies are stored in, created on first use. Resolved against the
   * working directory when relative. Use a directory nothing else writes to. Entries are never
   * removed, since a changed file gets a new one, so the directory can be cleared at any time,
   * such as on every deploy.
   */
  dir: string

  /**
   * The encodings files are compressed with, prioritized by their order in this array and
   * only applied if the client supports them (via Accept-Encoding).
   * `zstd` requires Node.js 22.15 or later.
   *
   * @default ['br', 'gzip']
   */
  encodings?: readonly ContentEncoding[]

  /**
   * The minimum file size in bytes required to trigger compression.
   * Smaller files are always served as they are.
   *
   * @default 1024 (1KB)
   */
  threshold?: number
}

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
   * When disabled, names shaped like 8.3 short names, such as `ENV~1`, are refused too,
   * since NTFS and FAT resolve them to dotfiles.
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
   * Compresses a file with a compressible content type the first time a client accepts an
   * encoding that no precompressed sidecar provides, then stores the result on disk, so each
   * file is compressed once per encoding instead of on every request. The first request waits
   * for the compression, and every request is answered from the stored copy like a sidecar,
   * keeping conditional and range requests working.
   *
   * @default undefined (disabled)
   */
  compressionCache?: StaticFileHandlerPluginCompressionCacheOptions

  /**
   * Whether symbolic links whose target lies outside `rootDir` can be served.
   * Enabling this makes every file the links reach publicly readable.
   *
   * @default false
   */
  allowSymlinks?: boolean

  /**
   * Content types keyed by lowercase file extension without the dot, taking precedence over
   * the type detected from the extension. Values are sent verbatim, so a text type needs its
   * own charset. Extensions that neither this nor the detection recognises are served as
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
 * @remarks
 * Deliberate deviations, all matching `send`, nginx, and Hono: range handling applies to `GET`
 * only, so `HEAD` always reports the full length even though `Accept-Ranges` advertises support;
 * a suffix range against an empty file answers `416`; and `dotfiles` is a request-path policy,
 * so it never applies to a configured `indexFile` or `fallbackFile`.
 *
 * @see {@link https://orpc.dev/docs/plugins/static-file | Static File Plugin}
 */
export class StaticFileHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~static-file'

  /**
   * Ensure the request span is available when the interceptor renames it.
   */
  after = ['~tracing']

  private readonly rootDir: string
  /** `rootDir` with a trailing separator, precomputed for the lexical containment check. */
  private readonly rootDirPrefix: string
  /**
   * `rootDir` with its own symbolic links resolved, paired with its trailing separator form.
   * Resolved once, so a symlinked `rootDir` keeps working and platform links like the macOS
   * `/var` to `/private/var` do not reject every file.
   */
  private readonly rootDirRealPaths: Promise<[rootDirReal: string, rootDirRealPrefix: string]>
  private readonly path: Exclude<StaticFileHandlerPluginOptions['path'], undefined>
  private readonly indexFile: Exclude<StaticFileHandlerPluginOptions['indexFile'], undefined>
  private readonly fallbackFile: StaticFileHandlerPluginOptions['fallbackFile']
  private readonly cacheControl: Exclude<StaticFileHandlerPluginOptions['cacheControl'], undefined>
  private readonly dotfiles: Exclude<StaticFileHandlerPluginOptions['dotfiles'], undefined>
  private readonly precompressed: Exclude<StaticFileHandlerPluginOptions['precompressed'], undefined>
  private readonly compressionCache: Required<StaticFileHandlerPluginCompressionCacheOptions> | undefined
  private readonly allowSymlinks: Exclude<StaticFileHandlerPluginOptions['allowSymlinks'], undefined>
  private readonly mimeTypes: Exclude<StaticFileHandlerPluginOptions['mimeTypes'], undefined>
  /** Compressions in progress keyed by cache path, so concurrent requests for a file share one. */
  private readonly pendingCompressions = new Map<string, Promise<Stats | undefined>>()

  constructor(options: StaticFileHandlerPluginOptions) {
    this.rootDir = path.resolve(options.rootDir)
    this.rootDirPrefix = this.rootDir.endsWith(path.sep) ? this.rootDir : this.rootDir + path.sep
    this.rootDirRealPaths = realpath(this.rootDir)
      .catch(() => this.rootDir)
      .then(rootDirReal => [rootDirReal, rootDirReal.endsWith(path.sep) ? rootDirReal : rootDirReal + path.sep])
    this.path = stripTrailingSlash(options.path ?? '/')
    this.indexFile = options.indexFile ?? 'index.html'
    this.fallbackFile = options.fallbackFile
    this.cacheControl = options.cacheControl ?? 'public, max-age=0'
    this.dotfiles = options.dotfiles ?? false
    this.precompressed = options.precompressed ?? false

    if (options.compressionCache !== undefined) {
      const encodings = options.compressionCache.encodings ?? ['br', 'gzip']

      if (encodings.includes('zstd') && typeof zlib.createZstdCompress !== 'function') {
        throw new TypeError('[StaticFileHandlerPlugin] The zstd compression cache encoding requires Node.js 22.15 or later')
      }

      this.compressionCache = {
        dir: path.resolve(options.compressionCache.dir),
        encodings,
        threshold: options.compressionCache.threshold ?? 1024,
      }
    }

    this.allowSymlinks = options.allowSymlinks ?? false
    // A null prototype prevents extensions like "constructor" from resolving through the prototype chain
    this.mimeTypes = Object.assign(Object.create(null) as Record<string, string>, options.mimeTypes)
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
      getTracer()?.getActiveSpan()?.updateName(`${request.method} ${base === '/' ? '' : base}/* (static file)`)

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

  /**
   * Resolves symbolic links and confirms the target is still inside the root,
   * which the lexical `resolveWithinRoot` check cannot see.
   */
  private async resolveContainedRealPath(filePath: string): Promise<string | undefined> {
    if (this.allowSymlinks) {
      return filePath
    }

    const [rootDirReal, rootDirRealPrefix] = await this.rootDirRealPaths
    // An empty string is contained by no root, so an unresolvable path is simply not contained
    const realPath = await realpath(filePath).catch(() => '')

    return realPath === rootDirReal || realPath.startsWith(rootDirRealPrefix) ? realPath : undefined
  }

  private resolveContentType(filePath: string): string {
    const extension = path.extname(filePath).slice(1).toLowerCase()
    const configured = this.mimeTypes[extension]

    if (configured !== undefined) {
      return configured
    }

    const contentType = mime.getType(extension)

    if (contentType === null) {
      return 'application/octet-stream'
    }

    return TEXT_CONTENT_TYPE_REGEX.test(contentType) ? `${contentType}; charset=utf-8` : contentType
  }

  private resolveBasePath(prefix: `/${string}` | undefined): `/${string}` {
    return prefix === undefined ? this.path : stripTrailingSlash(mergeHttpPath(prefix, this.path))
  }

  /**
   * Resolves segments under `rootDir` and stats the result, rejecting anything that
   * escapes the root either lexically or by following a symbolic link. The contained real
   * path is only resolved when `allowSymlinks` is disabled, and is the lexical path otherwise.
   */
  private async lookup(segments: string[]): Promise<[filePath: string, stats: Stats, containedRealPath: string] | undefined> {
    const filePath = this.resolveWithinRoot(segments)

    if (filePath === undefined) {
      return undefined
    }

    // Both resolutions are always needed, so they run together and cost the latency of one
    const [stats, containedRealPath] = await Promise.all([
      stat(filePath).catch(() => undefined),
      this.resolveContainedRealPath(filePath),
    ])

    if (stats === undefined || containedRealPath === undefined) {
      return undefined
    }

    return [filePath, stats, containedRealPath]
  }

  /**
   * Finds the first precompressed sidecar of `filePath` the client accepts.
   */
  private async findPrecompressedFile(filePath: string, qualities: Map<string, number>): Promise<EncodedFile | undefined> {
    const candidates = await Promise.all(PRECOMPRESSED_ENCODINGS
      .filter(encoding => isAcceptableEncoding(qualities, encoding))
      .map(async (encoding) => {
        const candidatePath = filePath + CONTENT_ENCODING_EXTENSIONS[encoding]
        // Sidecars are reached by string concatenation, so they need the same containment check
        const [candidateStats, containedRealPath] = await Promise.all([
          stat(candidatePath).catch(() => undefined),
          this.resolveContainedRealPath(candidatePath),
        ])

        return candidateStats?.isFile() && containedRealPath !== undefined
          ? { encoding, filePath: candidatePath, stats: candidateStats }
          : undefined
      }))

    return candidates.find(candidate => candidate !== undefined)
  }

  /**
   * Finds the compressed copy of `filePath` in the cache for the first encoding the client
   * accepts, compressing the file into the cache when no copy exists yet.
   */
  private async resolveCompressionCacheFile(
    compressionCache: Required<StaticFileHandlerPluginCompressionCacheOptions>,
    filePath: string,
    containedRealPath: string,
    stats: Stats,
    qualities: Map<string, number>,
  ): Promise<EncodedFile | undefined> {
    const encoding = compressionCache.encodings.find(encoding => isAcceptableEncoding(qualities, encoding))

    if (encoding === undefined) {
      return undefined
    }

    /**
     * Keyed by the real path, so the endless urls a symbolic link loop gives a single file share
     * one entry instead of filling the disk, and by the file version, so a changed file is
     * compressed again instead of a stale copy being served. The change time is part of the
     * version because, unlike the modification time, tools that copy files cannot restore it.
     */
    const realPath = this.allowSymlinks ? await realpath(filePath).catch(() => undefined) : containedRealPath

    if (realPath === undefined) {
      return undefined
    }

    const key = createHash('sha256').update(`${realPath}\0${toFileVersion(stats)}`).digest('hex')
    const cachePath = path.join(compressionCache.dir, key + CONTENT_ENCODING_EXTENSIONS[encoding])

    const cachedStats = await stat(cachePath).catch(() => undefined)
      ?? await this.compressIntoCache(compressionCache.dir, filePath, stats, encoding, cachePath)

    /**
     * A copy no smaller than the file saves nothing, so the file is served as it is. The copy is
     * still kept, so the file is not compressed again on every request.
     */
    if (cachedStats === undefined || !cachedStats.isFile() || cachedStats.size >= stats.size) {
      return undefined
    }

    return { encoding, filePath: cachePath, stats: cachedStats }
  }

  private compressIntoCache(
    cacheDir: string,
    filePath: string,
    stats: Stats,
    encoding: ContentEncoding,
    cachePath: string,
  ): Promise<Stats | undefined> {
    let pending = this.pendingCompressions.get(cachePath)

    if (pending === undefined) {
      pending = writeCompressedCopy(cacheDir, filePath, stats, encoding, cachePath)
        .finally(() => this.pendingCompressions.delete(cachePath))

      this.pendingCompressions.set(cachePath, pending)
    }

    return pending
  }

  /**
   * Normalizes the url path into filesystem segments,
   * returning `undefined` when the request can never map to a servable file.
   */
  private resolveSegments(pathname: string, base: `/${string}`): string[] | undefined {
    const segments: string[] = []

    for (const rawSegment of pathname.slice(base.length).split('/')) {
      const segment = safeDecodeURIComponent(rawSegment)

      if (segment === '' || segment === '.') {
        continue
      }

      /**
       * Dot segments are resolved in url space. One that would climb above the served path is
       * refused rather than clamped, so the path this plugin resolves always matches the one a
       * proxy in front of it sees after its own normalization.
       */
      if (segment === '..') {
        if (segments.length === 0) {
          return undefined
        }

        segments.pop()
        continue
      }

      if (segment.includes('\0') || segment.includes('/') || segment.includes('\\')) {
        return undefined
      }

      if (!this.dotfiles && (segment.startsWith('.') || SHORT_NAME_ALIAS_REGEX.test(segment))) {
        return undefined
      }

      segments.push(segment)
    }

    return segments
  }

  private async serve(request: StandardLazyRequest, base: `/${string}`): Promise<StandardResponse | undefined> {
    const [pathname, search] = parseStandardUrl(request.url)

    if (base !== '/' && !matchesHttpPathPrefix(pathname, base)) {
      return undefined
    }

    const segments = this.resolveSegments(pathname, base)

    if (segments === undefined) {
      return undefined
    }

    let found: [filePath: string, stats: Stats, containedRealPath: string] | undefined

    if (pathname.endsWith('/')) {
      // The url already denotes a directory, so only its index file can be served
      found = this.indexFile === false ? undefined : await this.lookup([...segments, this.indexFile])
    }
    else {
      found = await this.lookup(segments)

      if (found?.[1].isDirectory()) {
        if (this.indexFile === false) {
          found = undefined
        }
        else {
          /**
           * Rebuilt from the normalized segments rather than echoing the request target,
           * so the location can never be protocol relative or carry dot segments.
           * Redirected so relative links inside the index file resolve correctly.
           */
          const location = `${base === '/' ? '' : base}${segments.map(segment => `/${safeEncodeURIComponent(segment)}`).join('')}/`

          return {
            status: 301,
            headers: {
              location: `${location}${search ?? ''}`,
              ...this.cacheControl === false ? {} : { 'cache-control': this.cacheControl },
            },
          }
        }
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

    let [filePath, stats, containedRealPath] = found

    const contentType = this.resolveContentType(filePath)
    const isCompressible = isCompressibleContentType(contentType)
    const compressionCache = isCompressible && this.compressionCache !== undefined && stats.size >= this.compressionCache.threshold
      ? this.compressionCache
      : undefined
    const negotiatesEncoding = (this.precompressed && isCompressible) || compressionCache !== undefined

    let contentEncoding: string | undefined

    if (negotiatesEncoding) {
      const qualities = parseAcceptEncodingQualities(flattenStandardHeader(request.headers['accept-encoding']))

      // A sidecar is prepared ahead of time, usually with stronger compression, so it wins over the cache
      const encoded = (this.precompressed ? await this.findPrecompressedFile(filePath, qualities) : undefined)
        ?? (compressionCache !== undefined ? await this.resolveCompressionCacheFile(compressionCache, filePath, containedRealPath, stats, qualities) : undefined)

      if (encoded !== undefined) {
        filePath = encoded.filePath
        stats = encoded.stats
        contentEncoding = encoded.encoding
      }
    }

    const size = stats.size
    // Size and mtime at millisecond resolution, a strictly finer validator than the one nginx treats as strong
    const etag = `"${size.toString(16)}-${stats.mtime.getTime().toString(16)}"`
    // Truncated to seconds, matching the precision of http dates
    const lastModifiedTime = Math.floor(stats.mtime.getTime() / 1000) * 1000

    const headers: StandardHeaders = {
      'etag': etag,
      'last-modified': stats.mtime.toUTCString(),
      'accept-ranges': 'bytes',
    }

    if (negotiatesEncoding) {
      // Sent even for the identity variant, so caches key on the encoding
      headers.vary = 'accept-encoding'
    }

    if (this.cacheControl !== false) {
      headers['cache-control'] = this.cacheControl
    }

    if (isPreconditionFailed(request.headers, etag, lastModifiedTime)) {
      return { status: 412, headers }
    }

    if (isRequestFresh(request.headers, etag, lastModifiedTime)) {
      return { status: 304, headers }
    }

    let status = 200
    let start = 0
    let end = size - 1

    const range = request.method === 'GET' ? flattenStandardHeader(request.headers.range) : undefined

    if (range !== undefined && isRangeApplicable(request.headers, etag, lastModifiedTime)) {
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

    // Representation metadata is kept off the 304 and 416, neither of which carries the representation
    if (contentEncoding !== undefined) {
      headers['content-encoding'] = contentEncoding
    }

    headers['content-type'] = contentType
    headers['content-length'] = `${end - start + 1}`

    /**
     * A HEAD response uses an empty stream instead of no body, because
     * the adapters strip the content headers when the body is `undefined`.
     */
    const body: ReadableStream<Uint8Array<ArrayBuffer>> = request.method === 'HEAD'
      ? new ReadableStream({ start: controller => controller.close() })
      : toWebReadableStream(status === 206 ? createReadStream(filePath, { start, end }) : createReadStream(filePath))

    return { status, headers, body }
  }
}

/**
 * Identifies a version of a file's content, changing whenever the content may have changed.
 */
function toFileVersion(stats: Stats): string {
  return `${stats.size}-${stats.mtimeMs}-${stats.ctimeMs}`
}

/**
 * Each level is about the strongest that still compresses a megabyte in a tenth of a second,
 * since the first request for a file waits on it. Brotli 10 and 11 are ten to thirty times slower.
 */
function createCompressor(encoding: ContentEncoding): Transform {
  switch (encoding) {
    case 'br':
      return zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
    case 'zstd':
      return zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 15 } })
    case 'gzip':
      return zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION })
  }
}

/**
 * Compresses a file into the cache, returning the stats of the stored copy, or `undefined` when
 * it cannot be stored. A cache that cannot be written only costs the compression, so the caller
 * serves the file as it is instead of failing the request.
 */
async function writeCompressedCopy(
  cacheDir: string,
  filePath: string,
  stats: Stats,
  encoding: ContentEncoding,
  cachePath: string,
): Promise<Stats | undefined> {
  // Written beside its final name and renamed into place, so no reader ever sees a partial copy
  const tmpPath = `${cachePath}.${randomUUID()}.tmp`

  try {
    await mkdir(cacheDir, { recursive: true })
    // `wx` refuses to write through anything already at the temporary name
    await pipeline(createReadStream(filePath), createCompressor(encoding), createWriteStream(tmpPath, { flags: 'wx' }))

    // A file changed while it was read may have been compressed half old and half new
    if (toFileVersion(await stat(filePath)) !== toFileVersion(stats)) {
      return undefined
    }

    await rename(tmpPath, cachePath)

    return await stat(cachePath)
  }
  catch {
    return undefined
  }
  finally {
    // Already gone once renamed into place, otherwise a partial or discarded copy
    await rm(tmpPath, { force: true }).catch(() => {})
  }
}

function stripTrailingSlash(path: `/${string}`): `/${string}` {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) as `/${string}` : path
}

function stripWeakEtagPrefix(etag: string): string {
  return etag.startsWith('W/') ? etag.slice(2) : etag
}

/**
 * Evaluated before freshness, where `If-Match` takes precedence over `If-Unmodified-Since`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-precedence-of-preconditions
 */
function isPreconditionFailed(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number): boolean {
  const ifMatch = flattenStandardHeader(requestHeaders['if-match'])?.trim()
  // An empty list is malformed rather than unsatisfiable, so it is ignored
  if (ifMatch !== undefined && ifMatch !== '') {
    if (ifMatch === '*') {
      return false
    }

    // If-Match uses the strong comparison function, so a weak tag never matches
    return !ifMatch.split(',').some(tag => tag.trim() === etag)
  }

  const ifUnmodifiedSince = flattenStandardHeader(requestHeaders['if-unmodified-since'])
  if (ifUnmodifiedSince !== undefined) {
    const sinceTime = Date.parse(ifUnmodifiedSince)
    return !Number.isNaN(sinceTime) && lastModifiedTime > sinceTime
  }

  return false
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

function isRangeApplicable(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number): boolean {
  const ifRange = flattenStandardHeader(requestHeaders['if-range'])

  if (ifRange === undefined) {
    return true
  }

  // The etag form requires a strong comparison, so a weak tag can never match
  if (ifRange.startsWith('"') || ifRange.startsWith('W/')) {
    return ifRange === etag
  }

  return Date.parse(ifRange) === lastModifiedTime
}

function parseByteRange(range: string, size: number): [start: number, end: number] | 'unsatisfiable' | undefined {
  // The range unit is a case insensitive token and may be followed by optional whitespace
  const match = range.match(/^bytes=\s*(\d*)-(\d*)$/i)

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
