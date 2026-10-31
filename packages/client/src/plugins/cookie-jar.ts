import type { Promisable, Value } from '@orpc/shared'
import type { StandardHeaders } from '@standard-server/core'
import type { StandardLinkOptions, StandardLinkPlugin, StandardLinkTransportInterceptor, StandardLinkTransportInterceptorOptions } from '../adapters/standard'
import type { ClientContext, ClientOptions } from '../types'
import { toArray, value } from '@orpc/shared'

export interface CookieJarLinkPluginOptions<T extends ClientContext> {
  /**
   * The jar that stores cookies between calls.
   * Pass your own to share it between links or to read and clear its cookies,
   * or a function to pick a jar per request, for example from the client context.
   *
   * @default A new `CookieJar` for each plugin instance
   */
  jar?: Value<CookieJar, [options: StandardLinkTransportInterceptorOptions<T>]> | undefined

  /**
   * The origin requests are sent to, used to match the `Domain` and `Secure` cookie attributes like a browser.
   * Use the same value as the link's `origin` option.
   *
   * Without it, every request counts as going to the same secure site:
   * `Domain` is not checked and `Secure` cookies are always sent.
   *
   * @example 'https://api.example.com'
   */
  origin?: Value<Promisable<`https://${string}` | `http://${string}` | ({} & string) | undefined>, [options: ClientOptions<T>, path: string[]]> | undefined
}

/**
 * Stores the cookies servers set and sends them back on later requests, like a browser does,
 * for clients without a cookie store such as server-side rendering, scripts, and tests.
 *
 * @remarks
 * **Warning**: The cookies belong to the link, like a browser profile belongs to one user.
 * On a server, do not share one link between users: create a client per incoming request, or pick a jar per request.
 *
 * @see {@link https://orpc.dev/docs/plugins/cookie-jar | Cookie Jar Plugin}
 */
export class CookieJarLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  private readonly jar: Exclude<CookieJarLinkPluginOptions<T>['jar'], undefined>
  private readonly origin: CookieJarLinkPluginOptions<T>['origin']

  name = '~cookie-jar'

  /**
   * Cookies belong to the actual HTTP request, so handle them after batching,
   * once per batch request instead of once per subrequest, like a browser would see it.
   */
  after: string[] = ['~batch']

  constructor(options: NoInfer<CookieJarLinkPluginOptions<T>> = {}) {
    this.jar = options.jar ?? new CookieJar()
    this.origin = options.origin
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptor: StandardLinkTransportInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const { path, request } = interceptorOptions
      const jar = value(this.jar, interceptorOptions)

      let origin = await value(this.origin, interceptorOptions, path)
      if (origin?.endsWith('/')) {
        origin = origin.slice(0, -1)
      }

      const url = `${origin ?? ''}${request.url}`
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
   * The host the cookie was set by, or the `Domain` attribute when present.
   * `undefined` when the cookie was set without a known origin and without a `Domain` attribute.
   */
  domain: string | undefined

  /**
   * Whether the cookie is sent to `domain` only, not to its subdomains.
   * True when the cookie has no `Domain` attribute.
   */
  hostOnly: boolean

  path: string

  /**
   * Whether the cookie is only sent over secure connections.
   */
  secure: boolean

  /**
   * When the cookie expires, in milliseconds since the Unix epoch.
   * `undefined` for a session cookie, which lives as long as the jar.
   */
  expires: number | undefined
}

/**
 * An in-memory cookie store that follows the browser rules of [RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265):
 * it parses `Set-Cookie` headers, replaces and expires cookies, and selects the cookies to send by domain, path, and the `Secure` attribute.
 *
 * URLs passed to the jar are either absolute, or a path such as `/rpc/ping` when the origin is unknown.
 * Without an origin, the `Domain` attribute is not checked and the connection counts as secure.
 *
 * @see {@link https://orpc.dev/docs/plugins/cookie-jar#custom-jar | Cookie Jar Plugin - Custom Jar}
 */
export class CookieJar {
  /**
   * Keyed by domain, path, and name. Insertion order is creation order,
   * because replacing a cookie keeps its key's position, like it keeps its creation time in browsers.
   */
  private readonly cookies: Map<string, StoredCookie> = new Map()

  /**
   * Stores a cookie from a `Set-Cookie` header value received from `url`, the way a browser does.
   * Invalid cookies and cookies the URL is not allowed to set are ignored,
   * and a cookie that is already expired removes the stored cookie it replaces.
   */
  setCookie(setCookie: string, url: string): void {
    const parsed = parseSetCookie(setCookie)

    if (!parsed) {
      return
    }

    const target = parseCookieUrl(url)

    let domain = target.host
    let hostOnly = true

    if (parsed.domain !== undefined) {
      if (target.host !== undefined && !domainMatch(target.host, parsed.domain)) {
        return
      }

      domain = parsed.domain
      hostOnly = false
    }

    // Insecure origins cannot set cookies that are meant for secure connections only
    if (parsed.secure && !target.secure) {
      return
    }

    const lowerName = parsed.name.toLowerCase()

    if (lowerName.startsWith('__secure-') && !parsed.secure) {
      return
    }

    if (lowerName.startsWith('__host-') && (!parsed.secure || !hostOnly || parsed.path !== '/')) {
      return
    }

    const path = parsed.path ?? defaultPath(target.path)
    const key = `${domain ?? ''};${path};${parsed.name}`

    if (parsed.expires !== undefined && parsed.expires <= Date.now()) {
      this.cookies.delete(key)
      return
    }

    this.cookies.set(key, {
      name: parsed.name,
      value: parsed.value,
      domain,
      hostOnly,
      path,
      secure: parsed.secure,
      expires: parsed.expires,
    })
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

    const cookies = [...this.cookies.values()]

    if (url === undefined) {
      return cookies.map(cookie => ({ ...cookie }))
    }

    const target = parseCookieUrl(url)

    return cookies
      .filter(cookie =>
        (
          target.host === undefined
          || cookie.domain === undefined
          || (cookie.hostOnly ? target.host === cookie.domain : domainMatch(target.host, cookie.domain))
        )
        && pathMatch(target.path, cookie.path)
        && (!cookie.secure || target.secure),
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map(cookie => ({ ...cookie }))
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

  const explicitNames = new Set(
    explicit.split(';').map((pair) => {
      const separatorIndex = pair.indexOf('=')
      return separatorIndex === -1 ? '' : pair.slice(0, separatorIndex).trim()
    }),
  )

  const pairs = cookies
    .filter(cookie => !explicit || !explicitNames.has(cookie.name))
    .map(cookie => cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value)

  if (!pairs.length) {
    return undefined
  }

  return [explicit, ...pairs].filter(Boolean).join('; ')
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
 * except that a pair without `=` is a cookie with an empty name, as in RFC 6265bis and browsers.
 */
function parseSetCookie(setCookie: string): ParsedSetCookie | undefined {
  const [pair, ...attributes] = setCookie.split(';')
  const separatorIndex = pair!.indexOf('=')
  const name = separatorIndex === -1 ? '' : pair!.slice(0, separatorIndex).trim()
  const value = (separatorIndex === -1 ? pair! : pair!.slice(separatorIndex + 1)).trim()

  if (!name && !value) {
    return undefined
  }

  let domain: string | undefined
  let path: string | undefined
  let secure = false
  let expires: number | undefined
  let maxAge: number | undefined

  // A repeated attribute overrides the earlier ones
  for (const attribute of attributes) {
    const attributeSeparatorIndex = attribute.indexOf('=')
    const attributeName = (attributeSeparatorIndex === -1 ? attribute : attribute.slice(0, attributeSeparatorIndex)).trim().toLowerCase()
    const attributeValue = attributeSeparatorIndex === -1 ? '' : attribute.slice(attributeSeparatorIndex + 1).trim()

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
          maxAge = Number(attributeValue)
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

  if (maxAge !== undefined) {
    // Max-Age takes precedence over Expires, zero or negative expires the cookie immediately
    expires = maxAge <= 0 ? Number.NEGATIVE_INFINITY : Date.now() + maxAge * 1000
  }

  return { name, value, domain, path, secure, expires }
}

interface CookieUrl {
  host: string | undefined
  secure: boolean
  path: string
}

function parseCookieUrl(url: string): CookieUrl {
  if (url.startsWith('/')) {
    return {
      host: undefined,
      secure: true,
      path: new URL(url, 'http://localhost').pathname,
    }
  }

  const parsed = new URL(url)

  return {
    host: parsed.hostname,
    secure: parsed.protocol === 'https:' || parsed.protocol === 'wss:' || isLoopbackHost(parsed.hostname),
    path: parsed.pathname,
  }
}

/**
 * Browsers treat loopback hosts as secure, so `Secure` cookies also work against a local server.
 */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function isIPAddress(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

/**
 * [RFC 6265 Section 5.1.3](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.3)
 */
function domainMatch(host: string, domain: string): boolean {
  return host === domain || (host.endsWith(`.${domain}`) && !isIPAddress(host))
}

/**
 * [RFC 6265 Section 5.1.4](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.4)
 */
function defaultPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

/**
 * [RFC 6265 Section 5.1.4](https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.4)
 */
function pathMatch(path: string, cookiePath: string): boolean {
  return path === cookiePath
    || (path.startsWith(cookiePath) && (cookiePath.endsWith('/') || path[cookiePath.length] === '/'))
}
