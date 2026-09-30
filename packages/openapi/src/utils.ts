/**
 * GET and HEAD requests cannot carry a request body,
 * so their compact input maps to query parameters instead.
 */
export function isBodylessMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

const PARAMETER_NAME_REGEX = /^[\w-]+$/

/**
 * Dynamic parameters are always returned in path order.
 */
export function getDynamicPathParams(path: `/${string}`): {
  segment: string
  startIndex: number
  parameterName: string
  allowsSlash: boolean
}[] | undefined {
  if (!path.includes('{')) {
    return undefined
  }

  const len = path.length
  let params: {
    segment: string
    startIndex: number
    parameterName: string
    allowsSlash: boolean
  }[] | undefined

  let index = 1

  while (index < len) {
    const segmentStart = index
    const slashPos = path.indexOf('/', index)
    const segmentEnd = slashPos === -1 ? len : slashPos

    if (segmentEnd > segmentStart && path.charCodeAt(segmentStart) === 123 && path.charCodeAt(segmentEnd - 1) === 125) {
      let parameterStart = segmentStart + 1
      let allowsSlash = false

      const operator = path.charCodeAt(parameterStart)
      if (operator === 43) {
        allowsSlash = true
        parameterStart++
      }

      const parameterName = path.slice(parameterStart, segmentEnd - 1)
      if (PARAMETER_NAME_REGEX.test(parameterName)) {
        params ??= []
        params.push({
          segment: path.slice(segmentStart, segmentEnd),
          startIndex: segmentStart,
          parameterName,
          allowsSlash,
        })
      }
    }

    index = segmentEnd + 1
  }

  return params
}

/**
 * A slash-allowing param (`{+name}`) matches the rest of the path, so any segment after it could never match.
 *
 * @returns why the path is invalid, or `undefined` when it is valid
 */
export function validateDynamicPathParams(
  path: `/${string}`,
  params: ReturnType<typeof getDynamicPathParams>,
): string | undefined {
  for (const param of params ?? []) {
    if (!param.allowsSlash) {
      continue
    }

    const rest = path.slice(param.startIndex + param.segment.length)

    // a trailing slash is ignored when matching, so it does not count as another segment
    if (rest !== '' && rest !== '/') {
      return `The "${param.segment}" param must be the last segment of path "${path}", because it matches the rest of the path.`
    }
  }

  return undefined
}
