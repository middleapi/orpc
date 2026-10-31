import type { Value } from '@orpc/shared'
import type { StandardHeaders } from '@standard-server/core'
import type { FetchLinkTransportOptions } from '../adapters/fetch'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext } from '../types'
import { matchesHttpPathPrefix, toArray, value } from '@orpc/shared'

export interface CookieJarLinkPluginOptions<T extends ClientContext> {
  /**
   * The link's `origin`, used to scope cookies by host and scheme like a browser.
   * When it resolves to `undefined`, such as in a browser, the plugin does nothing.
   *
   * @example 'https://api.example.com'
   */
  origin: FetchLinkTransportOptions<T>['origin']

  /**
   * Where cookies are stored. Pass a function to pick a jar per request, e.g. from the client context.
   *
   * @default a new `CookieJar` per plugin
   */
  jar?: Value<CookieJar, [options: StandardLinkTransportInterceptorOptions<T>]> | undefined
}

/**
 * Stores the cookies servers set and sends them back on later requests, like a browser,
 * for clients outside a browser such as server-side rendering, scripts, and tests.
 *
 * @remarks
 * **Warning**: On a server, do not share one link between users: create a client per request, or pick a jar per request.
 *
 * @see {@link https://orpc.dev/docs/plugins/cookie-jar | Cookie Jar Plugin}
 */
export class CookieJarLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  private readonly origin: CookieJarLinkPluginOptions<T>['origin']
  private readonly jar: Exclude<CookieJarLinkPluginOptions<T>['jar'], undefined>

  name = '~cookie-jar'

  /**
   * Handle cookies after batching, once per actual HTTP request
   */
  after: string[] = ['~batch']

  constructor(options: NoInfer<CookieJarLinkPluginOptions<T>>) {
    this.origin = options.origin
    this.jar = options.jar ?? new CookieJar()
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const { path, request } = interceptorOptions
      const origin = await value(this.origin, interceptorOptions, path)

      if (origin === undefined) {
        return next()
      }

      const jar = value(this.jar, interceptorOptions)
      const url = `${origin.endsWith('/') ? origin.slice(0, -1) : origin}${request.url}`
      const cookie = mergeCookieHeader(request.headers.cookie, jar.getCookies(url))

      const response = await next(
        cookie === undefined
          ? interceptorOptions
          : { ...interceptorOptions, request: { ...request, headers: { ...request.headers, cookie } } },
      )

      for (const setCookie of toArray(response.headers['set-cookie'])) {
        jar.setCookie(setCookie, url)
      }

      return response
    }

    return {
      ...options,
      transportInterceptors: [
        ...toArray(options.transportInterceptors),
        transportInterceptor,
      ],
    }
  }
}

export interface StoredCookie {
  name: string
  value: string

  /**
   * The `Domain` attribute, or else the host that set the cookie.
   */
  domain: string

  /**
   * True when the cookie has no `Domain` attribute, so it is sent to `domain` only, not its subdomains.
   */
  hostOnly: boolean

  path: string
  secure: boolean

  /**
   * Expiry time in milliseconds since the Unix epoch, `undefined` for a session cookie that lives as long as the jar.
   */
  expires: number | undefined
}

/**
 * An in-memory cookie store that follows the browser rules of [RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265).
 *
 * @see {@link https://orpc.dev/docs/plugins/cookie-jar#custom-jar | Cookie Jar Plugin - Custom Jar}
 */
export class CookieJar {
  /**
   * Keyed by domain, path, and name. Map order is creation order: replacing a cookie keeps its position.
   */
  private readonly cookies: Map<string, StoredCookie> = new Map()

  /**
   * Stores a `Set-Cookie` header value received from `url`.
   * Cookies a browser would reject are ignored, and an expired cookie deletes the one it replaces.
   */
  setCookie(setCookie: string, url: string): void {
    const parsed = parseSetCookie(setCookie)

    if (!parsed) {
      return
    }

    const target = new URL(url)
    const hostOnly = parsed.domain === undefined
    const lowerName = parsed.name.toLowerCase()

    if (
      (parsed.domain !== undefined && !domainMatch(target.hostname, parsed.domain))
      // Insecure origins cannot set cookies meant for secure connections only
      || (parsed.secure && !isSecureUrl(target))
      || (lowerName.startsWith('__secure-') && !parsed.secure)
      || (lowerName.startsWith('__host-') && (!parsed.secure || !hostOnly || parsed.path !== '/'))
    ) {
      return
    }

    const domain = parsed.domain ?? target.hostname
    const path = parsed.path ?? defaultPath(target.pathname)
    const key = `${domain};${path};${parsed.name}`

    if (parsed.expires !== undefined && parsed.expires <= Date.now()) {
      this.cookies.delete(key)
      return
    }

    this.cookies.set(key, { ...parsed, domain, hostOnly, path })
  }

  /**
   * Returns the cookies a browser would send to `url`, longer paths first, then oldest first.
   * Without `url`, returns every stored cookie that has not expired.
   */
  getCookies(url?: string): StoredCookie[] {
    const now = Date.now()

    for (const [key, cookie] of this.cookies) {
      if (cookie.expires !== undefined && cookie.expires <= now) {
        this.cookies.delete(key)
      }
    }

    const cookies = [...this.cookies.values()].map(cookie => ({ ...cookie }))

    if (url === undefined) {
      return cookies
    }

    const target = new URL(url)
    const secure = isSecureUrl(target)

    return cookies
      .filter(cookie =>
        (cookie.hostOnly ? target.hostname === cookie.domain : domainMatch(target.hostname, cookie.domain))
        && matchesHttpPathPrefix(target.pathname as `/${string}`, cookie.path as `/${string}`)
        && (!cookie.secure || secure),
      )
      .sort((a, b) => b.path.length - a.path.length)
  }

  /**
   * Removes every stored cookie.
   */
  clear(): void {
    this.cookies.clear()
  }
}

/**
 * Appends the jar cookies to a `cookie` header set elsewhere, such as through the link's `headers` option.
 * Cookies already in that header win over jar cookies with the same name.
 *
 * Returns `undefined` when the jar has nothing to add.
 */
function mergeCookieHeader(header: StandardHeaders[string], cookies: StoredCookie[]): string | undefined {
  const explicit = toArray(header).map(value => value.trim()).filter(Boolean).join('; ')
  const explicitNames = new Set(explicit ? explicit.split(';').map(pair => splitCookiePair(pair)[0]) : [])

  const pairs = cookies
    .filter(cookie => !explicitNames.has(cookie.name))
    .map(cookie => cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value)

  if (!pairs.length) {
    return undefined
  }

  return [explicit, ...pairs].filter(Boolean).join('; ')
}

/**
 * Splits a cookie pair at the first `=`. A pair without `=` has an empty name, as in browsers.
 */
function splitCookiePair(pair: string): [name: string, value: string] {
  const index = pair.indexOf('=')
  return [index === -1 ? '' : pair.slice(0, index).trim(), pair.slice(index + 1).trim()]
}

interface ParsedSetCookie {
  name: string
  value: string
  domain: string | undefined
  path: string | undefined
  secure: boolean
  expires: number | undefined
}

/**
 * Parses a `Set-Cookie` header value following [RFC 6265 Section 5.2](https://datatracker.ietf.org/doc/html/rfc6265#section-5.2),
 * except that a pair without `=` is kept as a cookie with an empty name instead of being ignored,
 * like browsers and [RFC 6265bis](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) do.
 */
function parseSetCookie(setCookie: string): ParsedSetCookie | undefined {
  const [pair = '', ...attributes] = setCookie.split(';')
  const [name, value] = splitCookiePair(pair)

  if (!name && !value) {
    return undefined
  }

  let domain: string | undefined
  let path: string | undefined
  let secure = false
  let expires: number | undefined
  let maxAgeExpires: number | undefined

  // A repeated attribute overrides the earlier ones
  for (const attribute of attributes) {
    const index = attribute.indexOf('=')
    const attributeName = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase()
    const attributeValue = index === -1 ? '' : attribute.slice(index + 1).trim()

    switch (attributeName) {
      case 'expires': {
        const time = Date.parse(attributeValue)

        if (!Number.isNaN(time)) {
          expires = time
        }

        break
      }

      case 'max-age': {
        if (/^-?\d+$/.test(attributeValue)) {
          maxAgeExpires = Date.now() + Number(attributeValue) * 1000
        }

        break
      }

      case 'domain': {
        domain = attributeValue.replace(/^\./, '').toLowerCase() || undefined
        break
      }

      case 'path': {
        path = attributeValue.startsWith('/') ? attributeValue : undefined
        break
      }

      case 'secure': {
        secure = true
        break
      }
    }
  }

  // Max-Age takes precedence over Expires
  return { name, value, domain, path, secure, expires: maxAgeExpires ?? expires }
}

/**
 * Browsers also treat loopback hosts as secure, so `Secure` cookies work against a local server.
 */
function isSecureUrl(url: URL): boolean {
  const host = url.hostname

  return url.protocol === 'https:'
    || url.protocol === 'wss:'
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/**
 * [RFC 6265 Section 5.1.3](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.3)
 */
function domainMatch(host: string, domain: string): boolean {
  const isIPAddress = host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
  return host === domain || (host.endsWith(`.${domain}`) && !isIPAddress)
}

/**
 * [RFC 6265 Section 5.1.4](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.4)
 */
function defaultPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
