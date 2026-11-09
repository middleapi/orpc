import type { Value } from '@orpc/shared'
import { matchesHttpPathPrefix, toArray, value } from '@orpc/shared'
import type { StandardHeaders } from '@standard-server/core'

import type { FetchLinkTransportOptions } from '../adapters/fetch/index'
import type {
  StandardLinkOptions,
  StandardLinkPlugin,
  StandardLinkTransportInterceptor,
  StandardLinkTransportInterceptorOptions,
} from '../adapters/standard/index'
import type { ClientContext } from '../types'

export interface CookieJarLinkPluginOptions<T extends ClientContext> {
  /**
   * The link's `origin`, used to match cookies by host and scheme.
   * The plugin does nothing when it resolves to `undefined` or a relative origin, as in a browser.
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
 * for server-side rendering, scripts, and tests.
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
   * Runs per call, before batching, so each call gets the cookies it would get on its own.
   */
  before: string[] = ['~batch']

  constructor(options: NoInfer<CookieJarLinkPluginOptions<T>>) {
    this.origin = options.origin
    this.jar = options.jar ?? new CookieJar()
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({
      next,
      ...interceptorOptions
    }) => {
      const { path, request } = interceptorOptions
      const origin = await value(this.origin, interceptorOptions, path)

      // No absolute origin, as in a browser
      if (origin === undefined || !/^[a-z][\d+\-.a-z]*:/i.test(origin)) {
        return next()
      }

      const jar = value(this.jar, interceptorOptions)
      const url = `${origin.replace(/\/$/, '')}${request.url}`
      const cookie = mergeCookieHeader(request.headers.cookie, jar.getCookies(url))

      const response = await next(
        cookie === undefined
          ? interceptorOptions
          : {
              ...interceptorOptions,
              request: { ...request, headers: { ...request.headers, cookie } },
            },
      )

      for (const setCookie of toArray(response.headers['set-cookie'])) {
        jar.setCookie(setCookie, url)
      }

      return response
    }

    return {
      ...options,
      transportInterceptors: [...toArray(options.transportInterceptors), transportInterceptor],
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
    const secureUrl = isSecureUrl(target)
    const hostOnly = parsed.domain === undefined
    const domain = parsed.domain ?? target.hostname
    const path = parsed.path ?? defaultPath(target.pathname)

    if (
      !domainMatch(target.hostname, domain) ||
      (/^__(?:secure|host)-/i.test(parsed.name) && !parsed.secure) ||
      (/^__host-/i.test(parsed.name) && (!hostOnly || parsed.path !== '/')) ||
      // Insecure origins can neither set nor overwrite secure cookies, see "leave secure cookies alone" in RFC 6265bis
      (!secureUrl &&
        (parsed.secure ||
          [...this.cookies.values()].some(
            (cookie) =>
              cookie.secure &&
              cookie.name === parsed.name &&
              (domainMatch(domain, cookie.domain) || domainMatch(cookie.domain, domain)) &&
              matchesHttpPathPrefix(path as `/${string}`, cookie.path as `/${string}`),
          )))
    ) {
      return
    }

    const key = `${domain};${path};${parsed.name}`

    if ((parsed.expires ?? Number.POSITIVE_INFINITY) <= Date.now()) {
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
      if ((cookie.expires ?? Number.POSITIVE_INFINITY) <= now) {
        this.cookies.delete(key)
      }
    }

    const cookies = [...this.cookies.values()].map((cookie) => ({ ...cookie }))

    if (url === undefined) {
      return cookies
    }

    const target = new URL(url)
    const secureUrl = isSecureUrl(target)

    return (
      cookies
        .filter(
          (cookie) =>
            (cookie.hostOnly
              ? target.hostname === cookie.domain
              : domainMatch(target.hostname, cookie.domain)) &&
            matchesHttpPathPrefix(target.pathname as `/${string}`, cookie.path as `/${string}`) &&
            (!cookie.secure || secureUrl),
        )
        // oxlint-disable-next-line unicorn/no-array-sort
        .sort((a, b) => b.path.length - a.path.length)
    )
  }

  /**
   * Removes every stored cookie.
   */
  clear(): void {
    this.cookies.clear()
  }
}

/**
 * Appends jar cookies to an existing `cookie` header, skipping names it already has.
 * Returns `undefined` when the jar adds nothing.
 */
function mergeCookieHeader(
  header: StandardHeaders[string],
  cookies: StoredCookie[],
): string | undefined {
  const explicit = toArray(header)
    .flatMap((value) => value.split(';'))
    .map((pair) => pair.trim())
    .filter(Boolean)
  const explicitNames = new Set(explicit.map((pair) => splitCookiePair(pair)[0]))

  const pairs = cookies
    .filter((cookie) => !explicitNames.has(cookie.name))
    .map((cookie) => (cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value))

  return pairs.length ? [...explicit, ...pairs].join('; ') : undefined
}

/**
 * Splits a cookie pair at the first `=`. A pair without `=` has an empty name, as in browsers and RFC 6265bis.
 */
function splitCookiePair(pair: string): [name: string, value: string] {
  const index = pair.indexOf('=')
  return [index === -1 ? '' : pair.slice(0, index).trim(), pair.slice(index + 1).trim()]
}

/**
 * Parses a `Set-Cookie` header value following [RFC 6265 Section 5.2](https://datatracker.ietf.org/doc/html/rfc6265#section-5.2),
 * with the [RFC 6265bis](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) changes browsers use, noted inline.
 */
function parseSetCookie(setCookie: string) {
  // Control characters other than tab make the whole cookie invalid
  // oxlint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0A-\x1F\x7F]/.test(setCookie)) {
    return undefined
  }

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
    const attributeName = (index === -1 ? attribute : attribute.slice(0, index))
      .trim()
      .toLowerCase()
    const attributeValue = index === -1 ? '' : attribute.slice(index + 1).trim()

    switch (attributeName) {
      case 'expires': {
        expires = parseCookieDate(attributeValue) ?? expires
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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Parses a cookie date following [RFC 6265 Section 5.1.1](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.1),
 * always in UTC. Returns `undefined` when a part is missing or out of range, so the attribute is ignored.
 */
function parseCookieDate(value: string): number | undefined {
  let time: [hour: number, minute: number, second: number] | undefined
  let day: number | undefined
  let month: number | undefined
  let year: number | undefined

  for (const token of value.split(/[\t\x20-\x2F\x3B-\x40\x5B-\x60\x7B-\x7E]+/)) {
    const digits = /^\d*/.exec(token)![0]
    const timeMatch = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D|$)/.exec(token)
    const monthIndex = MONTHS.indexOf(token.slice(0, 3).toLowerCase())

    if (time === undefined && timeMatch) {
      time = [Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3])]
    } else if (day === undefined && digits.length >= 1 && digits.length <= 2) {
      day = Number(digits)
    } else if (month === undefined && monthIndex !== -1) {
      month = monthIndex
    } else if (year === undefined && digits.length >= 2 && digits.length <= 4) {
      year = Number(digits)
      year += year < 70 ? 2000 : year < 100 ? 1900 : 0
    }
  }

  if (time === undefined || day === undefined || month === undefined || year === undefined) {
    return undefined
  }

  const [hour, minute, second] = time

  if (year < 1601 || hour > 23 || minute > 59 || second > 59) {
    return undefined
  }

  const date = Date.UTC(year, month, day, hour, minute, second)

  // Rejects days the month does not have, such as 0 or 31 Feb
  return new Date(date).getUTCDate() === day ? date : undefined
}

/**
 * Browsers also treat loopback hosts as secure, so `Secure` cookies work against a local server.
 */
function isSecureUrl(url: URL): boolean {
  const host = url.hostname

  return (
    url.protocol === 'https:' ||
    url.protocol === 'wss:' ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

/**
 * [RFC 6265 Section 5.1.3](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.3)
 */
function domainMatch(host: string, domain: string): boolean {
  // IPv6 hosts have no dots, so only IPv4 addresses need excluding
  return host === domain || (host.endsWith(`.${domain}`) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))
}

/**
 * [RFC 6265 Section 5.1.4](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.4)
 */
function defaultPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
