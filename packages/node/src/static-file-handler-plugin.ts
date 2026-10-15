import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { Stats } from 'node:fs'
import type { Transform } from 'node:stream'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, realpath, rename, rm, stat, truncate, utimes } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
// A namespace import, since a named import of `createZstdCompress` fails to load before Node.js 22.15
import * as zlib from 'node:zlib'
import { getOwn, getTracer, isAcceptableEncoding, isCompressibleContentType, matchesHttpPathPrefix, mergeHttpPath, parseAcceptEncodingQualities, safeDecodeURIComponent, safeEncodeURIComponent, toArray } from '@orpc/shared'
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

interface ContentEncodingSpec {
  /** The extension of the sidecar holding a file in this encoding. */
  extension: string
  /**
   * Creates a compressor for an input of `size` bytes, or is `undefined` when this runtime
   * cannot compress into the encoding.
   */
  createCompressor: ((size: number) => Transform) | undefined
}

/**
 * Each compression level is about the strongest that still compresses a megabyte in a tenth of
 * a second, since the first request for a file waits on it. Brotli 10 and 11 are ten to thirty
 * times slower. zstd is told the input size, without which it sizes its window and tables for an
 * input of any length, costing a small file tens of milliseconds and every stream tens of
 * megabytes. zstd compression only exists from Node.js 22.15.
 */
const CONTENT_ENCODINGS: Record<'br' | 'zstd' | 'gzip', ContentEncodingSpec> = {
  br: {
    extension: '.br',
    createCompressor: () => zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
  },
  zstd: {
    extension: '.zst',
    createCompressor: typeof zlib.createZstdCompress === 'function'
      ? size => zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 15 }, pledgedSrcSize: size })
      : undefined,
  },
  gzip: {
    extension: '.gz',
    createCompressor: () => zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION }),
  },
}

type ContentEncoding = keyof typeof CONTENT_ENCODINGS

/**
 * Compressed output depends on the library versions and the compression parameters as well as
 * the content, so processes on different Node.js versions or releases of this plugin sharing one
 * cache, as in a rolling deploy, never write different bytes to the same copy while another
 * process is serving it. The leading number covers the parameters and the cache layout, and is
 * raised whenever either changes.
 */
const COMPRESSOR_VERSIONS = `1-${process.versions.zlib}-${process.versions.brotli}-${process.versions.zstd}`

/** Encodings in order of preference, best compression first. */
const PREFERRED_ENCODINGS: readonly ContentEncoding[] = ['br', 'zstd', 'gzip']

/**
 * How many compressions run at once. Each holds a libuv thread, which file system calls share,
 * and tens of megabytes while it works, so a burst of first requests for many files neither
 * stalls every other request nor exhausts memory.
 */
const MAX_CONCURRENT_COMPRESSIONS = 2

/**
 * How long a copy that could not be stored, as on a full disk, is not attempted again, since
 * brotli only fails to write once it has compressed the whole file.
 */
const FAILED_COMPRESSION_COOLDOWN_MS = 60_000

/**
 * A file found under the root, with its real path. With `allowSymlinks` nothing checks
 * containment, so the path is left unresolved and resolved only when the file is compressed.
 */
type FoundFile = [filePath: string, stats: Stats, realPath: string]

interface CacheCompressor {
  encoding: ContentEncoding
  createCompressor: (size: number) => Transform
}

interface CompressionCache {
  dir: string
  /** The configured encodings this runtime can compress into, in order of preference. */
  compressors: readonly CacheCompressor[]
  threshold: number
  maxSize: number
}

interface EncodedFile {
  encoding: ContentEncoding
  filePath: string
  stats: Stats
}

export interface StaticFileHandlerPluginCompressOnDemandOptions {
  /**
   * The directory compressed copies are stored in, created on first use and resolved against
   * the working directory when relative. Use a directory nothing else writes to. Copies of files
   * that have since changed are never removed, so clear it from time to time, ideally while no
   * request is being served, such as on deploy, since a request reading a copy that is removed
   * fails.
   */
  cacheDir: string

  /**
   * The encodings files are compressed into, prioritized by their order in this array and
   * only applied if the client supports them (via Accept-Encoding). `zstd` requires Node.js
   * 22.15 or later, and older versions skip it.
   *
   * @default ['br', 'zstd', 'gzip']
   */
  encodings?: readonly ContentEncoding[]

  /**
   * The minimum file size in bytes required to trigger compression.
   * Smaller files are always served as they are.
   *
   * @default 1024 (1KB)
   */
  threshold?: number

  /**
   * The maximum file size in bytes a request waits to compress. A larger file is compressed in
   * the background instead, and served as it is until its copy is ready, with `no-cache` added
   * to its `Cache-Control` so caches come back for the copy, so no request waits long on a big
   * file. Set to `0` to never wait.
   *
   * @default 1048576 (1MB)
   */
  maxSize?: number
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
   * Compresses a file with a compressible content type the first time a client accepts one of
   * the configured encodings but none of the file's precompressed sidecars, and stores the copy
   * in `cacheDir`, so every later request, after a restart too, is answered from it. Range
   * requests are answered from the file rather than the copy, since many clients that ask for
   * compression cannot decode a slice of a compressed one. Only a couple of files are compressed
   * at once, and while those run, other files are served as they are, the way files over
   * `maxSize` are.
   *
   * @default undefined (disabled)
   */
  compressOnDemand?: StaticFileHandlerPluginCompressOnDemandOptions

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
  private readonly compressOnDemand: CompressionCache | undefined
  private readonly allowSymlinks: Exclude<StaticFileHandlerPluginOptions['allowSymlinks'], undefined>
  private readonly mimeTypes: Exclude<StaticFileHandlerPluginOptions['mimeTypes'], undefined>
  /** Compressions in progress keyed by cache path, so concurrent requests share one. */
  private readonly pendingCompressions = new Map<string, Promise<Stats | undefined>>()
  /** Cache paths whose copy could not be stored, left alone until their cooldown ends. */
  private readonly failedCompressions = new Set<string>()

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

    if (options.compressOnDemand !== undefined) {
      // An encoding this runtime cannot compress into leaves its clients to their next accepted one
      const compressors = (options.compressOnDemand.encodings ?? PREFERRED_ENCODINGS).flatMap((encoding) => {
        const spec = getOwn(CONTENT_ENCODINGS, encoding)

        if (spec === undefined) {
          throw new TypeError(`[StaticFileHandlerPlugin] Unsupported compressOnDemand encoding: ${String(encoding)}`)
        }

        const { createCompressor } = spec

        return createCompressor === undefined ? [] : [{ encoding, createCompressor }]
      })

      // With nothing to compress into, no file is ever encoded, so none needs negotiating
      if (compressors.length > 0) {
        this.compressOnDemand = {
          dir: path.resolve(options.compressOnDemand.cacheDir),
          compressors,
          threshold: options.compressOnDemand.threshold ?? 1024,
          maxSize: options.compressOnDemand.maxSize ?? 1024 * 1024,
        }
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
   * escapes the root either lexically or by following a symbolic link.
   */
  private async lookup(segments: string[]): Promise<FoundFile | undefined> {
    const filePath = this.resolveWithinRoot(segments)

    if (filePath === undefined) {
      return undefined
    }

    // Both resolutions are always needed, so they run together and cost the latency of one
    const [stats, realPath] = await Promise.all([
      stat(filePath).catch(() => undefined),
      this.resolveContainedRealPath(filePath),
    ])

    if (stats === undefined || realPath === undefined) {
      return undefined
    }

    return [filePath, stats, realPath]
  }

  /**
   * Finds the precompressed sidecar of `filePath` in the first encoding the client accepts.
   */
  private async findPrecompressedFile(filePath: string, qualities: Map<string, number>): Promise<EncodedFile | undefined> {
    const candidates = await Promise.all(PREFERRED_ENCODINGS
      .filter(encoding => isAcceptableEncoding(qualities, encoding))
      .map(async (encoding) => {
        const candidatePath = filePath + CONTENT_ENCODINGS[encoding].extension
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
   * accepts, compressing the file into the cache when no copy exists yet. Resolves to `'interim'`
   * when the file is served as it is only until its copy is ready, and to `'stale'` when no copy
   * came of a compression the request waited on, during which the file may have changed.
   */
  private async resolveCompressionCacheFile(
    compressionCache: CompressionCache,
    filePath: string,
    realPath: string,
    stats: Stats,
    qualities: Map<string, number>,
  ): Promise<EncodedFile | 'interim' | 'stale' | undefined> {
    const compressor = compressionCache.compressors.find(({ encoding }) => isAcceptableEncoding(qualities, encoding))

    if (compressor === undefined) {
      return undefined
    }

    // Left unresolved by the lookup with `allowSymlinks`, so a file whose links cannot be resolved is served as it is
    const keyPath = this.allowSymlinks ? await realpath(filePath).catch(() => undefined) : realPath

    if (keyPath === undefined) {
      return undefined
    }

    /**
     * Keyed by the real path, so the endless urls a symbolic link loop gives a single file share
     * one entry instead of filling the disk, and by the file version, so a changed file is
     * compressed again instead of a stale copy being served. The change time is part of the
     * version because, unlike the modification time, tools that copy files cannot restore it.
     */
    const key = createHash('sha256').update(`${keyPath}\0${toFileVersion(stats)}\0${COMPRESSOR_VERSIONS}`).digest('hex')
    const cachePath = path.join(compressionCache.dir, key + CONTENT_ENCODINGS[compressor.encoding].extension)
    const cachedStats = await this.statOrCompress(
      cachePath,
      () => writeCompressedCopy(filePath, stats, compressor.createCompressor, cachePath),
      stats.size <= compressionCache.maxSize,
    )

    if (cachedStats === undefined || typeof cachedStats === 'string') {
      return cachedStats
    }

    /**
     * A file compression does not make smaller is marked by an empty copy, which no compressed
     * stream ever is, so it is served as it is without being compressed again on every request.
     */
    if (!cachedStats.isFile() || cachedStats.size === 0 || cachedStats.size >= stats.size) {
      return undefined
    }

    return { encoding: compressor.encoding, filePath: cachePath, stats: cachedStats }
  }

  /**
   * Stats the cached copy, compressing the file into the cache when it is missing. A request waits
   * for the compression only when `waits` is set and a compression slot is free, and otherwise
   * resolves to `'interim'`, leaving the copy to be written in the background or, with every slot
   * taken, by a later request. Resolves to `undefined` while a failed copy cools down.
   */
  private async statOrCompress(
    cachePath: string,
    compress: () => Promise<Stats | undefined>,
    waits: boolean,
  ): Promise<Stats | 'interim' | 'stale' | undefined> {
    let compression = this.pendingCompressions.get(cachePath)

    if (compression === undefined) {
      const cachedStats = await stat(cachePath).catch(() => undefined)

      if (cachedStats !== undefined) {
        return cachedStats
      }

      if (this.failedCompressions.has(cachePath)) {
        return undefined
      }

      // Started by a concurrent request while this one looked
      compression = this.pendingCompressions.get(cachePath)

      if (compression === undefined) {
        if (this.pendingCompressions.size >= MAX_CONCURRENT_COMPRESSIONS) {
          return 'interim'
        }

        // Looked up again first, since a compression that just finished leaves its copy but no entry
        compression = stat(cachePath)
          .catch(compress)
          .then((copyStats) => {
            this.pendingCompressions.delete(cachePath)

            if (copyStats === undefined) {
              this.failedCompressions.add(cachePath)
              setTimeout(() => this.failedCompressions.delete(cachePath), FAILED_COMPRESSION_COOLDOWN_MS).unref()
            }

            return copyStats
          })

        this.pendingCompressions.set(cachePath, compression)
      }
    }

    if (!waits) {
      return 'interim'
    }

    return await compression ?? 'stale'
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

    let found: FoundFile | undefined

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

    let [filePath, stats, realPath] = found

    const fileSize = stats.size
    const contentType = this.resolveContentType(filePath)
    const range = request.method === 'GET' ? flattenStandardHeader(request.headers.range) : undefined
    const eligibleCache = this.compressOnDemand !== undefined && stats.size >= this.compressOnDemand.threshold
      ? this.compressOnDemand
      : undefined
    const negotiatesEncoding = (this.precompressed || eligibleCache !== undefined) && isCompressibleContentType(contentType)

    let contentEncoding: string | undefined
    /** Whether the file is served as it is only until its compressed copy is ready. */
    let isInterim = false

    if (negotiatesEncoding) {
      const qualities = parseAcceptEncodingQualities(flattenStandardHeader(request.headers['accept-encoding']))

      /**
       * A sidecar is prepared ahead of time, usually with stronger compression, so it wins over the
       * cache. A range is answered from the file as it is rather than the cache, since clients that
       * decode what they asked to be compressed fail on a slice from the middle of a compressed copy.
       */
      const encoded = (this.precompressed ? await this.findPrecompressedFile(filePath, qualities) : undefined)
        ?? (eligibleCache !== undefined && range === undefined ? await this.resolveCompressionCacheFile(eligibleCache, filePath, realPath, stats, qualities) : undefined)

      if (encoded === 'interim') {
        isInterim = true
      }
      else if (encoded === 'stale') {
        // The file is read again for the stats, so they describe the bytes that are sent
        const currentStats = await stat(filePath).catch(() => undefined)

        if (currentStats === undefined || !currentStats.isFile()) {
          return undefined
        }

        stats = currentStats
      }
      else if (encoded !== undefined) {
        filePath = encoded.filePath
        stats = encoded.stats
        contentEncoding = encoded.encoding
      }
    }

    const size = stats.size
    const mtime = stats.mtime.getTime().toString(16)
    /**
     * Size and mtime at millisecond resolution, a strictly finer validator than the one nginx treats
     * as strong. An encoded variant also names its encoding, since compressed copies share the
     * file's modification time and two encodings can come out the same size, and the size of the
     * file itself, so it changes whenever the file's own validator does even when a changed file
     * compresses to the same size.
     */
    const etag = contentEncoding === undefined
      ? `"${size.toString(16)}-${mtime}"`
      : `"${size.toString(16)}-${fileSize.toString(16)}-${mtime}-${contentEncoding}"`
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
      // Replaced by the compressed copy once it is ready, so caches must come back for it instead of keeping this response
      headers['cache-control'] = isInterim ? `${this.cacheControl}, no-cache` : this.cacheControl
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

    if (range !== undefined && isRangeApplicable(request.headers, etag, lastModifiedTime, negotiatesEncoding)) {
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
     * The read stops at the stated length, so a file that grew since it was
     * found never sends more than its `Content-Length`.
     */
    const body: ReadableStream<Uint8Array<ArrayBuffer>> = request.method === 'HEAD' || size === 0
      ? new ReadableStream({ start: controller => controller.close() })
      : toWebReadableStream(createReadStream(filePath, { start, end }))

    return { status, headers, body }
  }
}

/**
 * Identifies a version of a file's content, changing whenever the content may have changed.
 * The inode number tells a file replaced by a rename apart from the one it replaced, even when
 * both were written within one tick of the clock the timestamps come from.
 */
function toFileVersion(stats: Stats): string {
  return `${stats.ino}-${stats.size}-${stats.mtimeMs}-${stats.ctimeMs}`
}

/**
 * Compresses a file into the cache, returning the stats of the stored copy, or `undefined` when
 * it cannot be stored. A cache that cannot be written only costs the compression, so the caller
 * serves the file as it is instead of failing the request.
 */
async function writeCompressedCopy(
  filePath: string,
  stats: Stats,
  createCompressor: (size: number) => Transform,
  cachePath: string,
): Promise<Stats | undefined> {
  // Written beside its final name and renamed into place, so no reader ever sees a partial copy
  const tmpPath = `${cachePath}.${randomUUID()}.tmp`

  try {
    await mkdir(path.dirname(cachePath), { recursive: true })

    // Created before the file is opened, so a compressor that cannot be created leaves nothing open
    const compressor = createCompressor(stats.size)

    /**
     * `wx` refuses to write through anything already at the temporary name, and `flush` makes the
     * copy durable before it is renamed into place, since a crash could otherwise leave an empty
     * or partial copy under its final name.
     */
    await pipeline(createReadStream(filePath), compressor, createWriteStream(tmpPath, { flags: 'wx', flush: true }))

    // A copy no smaller than the file saves nothing, so it is emptied to mark the file as not worth compressing
    if ((await stat(tmpPath)).size >= stats.size) {
      await truncate(tmpPath, 0)
    }

    /**
     * The copy takes the file's modification time, so its ETag and Last-Modified depend only on
     * the content, not on when or where it was compressed, and stay stable across instances and
     * after the cache is cleared.
     */
    await utimes(tmpPath, stats.atime, stats.mtime)

    // Renaming keeps the size and modification time, so the copy's stats are read before it moves
    const [currentStats, copyStats] = await Promise.all([stat(filePath), stat(tmpPath)])

    // A file changed while it was read may have been compressed half old and half new
    if (toFileVersion(currentStats) === toFileVersion(stats)) {
      await rename(tmpPath, cachePath)

      return copyStats
    }
  }
  catch {}

  await rm(tmpPath, { force: true }).catch(() => {})

  return undefined
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

/**
 * The date form only applies when the representation does not depend on Accept-Encoding. Encoded
 * variants share the file's modification time, so a date is no strong validator for any of them
 * and cannot tell which one a partial download came from.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range
 */
function isRangeApplicable(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number, negotiatesEncoding: boolean): boolean {
  const ifRange = flattenStandardHeader(requestHeaders['if-range'])

  if (ifRange === undefined) {
    return true
  }

  // The etag form requires a strong comparison, so a weak tag can never match
  if (ifRange.startsWith('"') || ifRange.startsWith('W/')) {
    return ifRange === etag
  }

  return !negotiatesEncoding && Date.parse(ifRange) === lastModifiedTime
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
