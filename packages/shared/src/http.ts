import { tryDecodeURIComponent } from './uri'

export function pathToHttpPath(path: readonly string[]): `/${string}` {
  return `/${path.map(encodeURIComponent).join('/')}`
}

export function normalizeHttpPath(path: string): `/${string}` {
  const paths = path.split('/')

  if (paths.at(0) === '') {
    paths.shift()
  }

  return pathToHttpPath(paths.map(tryDecodeURIComponent))
}

export function mergeHttpPath(a: `/${string}`, b: `/${string}`): `/${string}` {
  return `${a.endsWith('/') ? a.slice(0, -1) : a}${b}` as `/${string}`
}

export function matchesHttpPathPrefix(url: `/${string}`, prefix: `/${string}`): boolean {
  if (!url.startsWith(prefix)) {
    return false
  }

  const charAfterPrefix = url[prefix.length]

  // order by most common cases for better performance
  return charAfterPrefix === '/'
    || charAfterPrefix === '?'
    || charAfterPrefix === '#'
    || charAfterPrefix === undefined
    || prefix[prefix.length - 1] === '/'
}

export function matchesHttpPath(url: `/${string}`, path: `/${string}`): boolean {
  const pathWithoutEndSlash = path.endsWith('/') ? path.slice(0, path.length - 1) : path

  if (!url.startsWith(pathWithoutEndSlash)) {
    return false
  }

  let charAfterPrefix = url[pathWithoutEndSlash.length]

  if (charAfterPrefix === '/') {
    charAfterPrefix = url[pathWithoutEndSlash.length + 1]
  }

  // order by most common cases for better performance
  return charAfterPrefix === undefined
    || charAfterPrefix === '?'
    || charAfterPrefix === '#'
}
