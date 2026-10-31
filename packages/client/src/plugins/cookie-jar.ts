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
 * @see {@link https://orpc.dev/docs/plugins/cookies-management#cookie-jar | Cookies Management Plugin - Cookie Jar}
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
