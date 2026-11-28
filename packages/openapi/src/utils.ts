/**
 * GET and HEAD requests cannot carry a request body,
 * so their compact input maps to query parameters instead.
 */
export function isBodylessMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

const PARAMETER_NAME_REGEX = /^[\w-]+$/
const SEGMENT_PARAMETER_REGEX = /\{([\w-]+)\}/g

/**
 * The `{name}` and `{+name}` params of a path, in path order, the way
 * `@openapi-spec/router` reads them. `segment` is the param's own text, as in
 * `{id}` for `/apps/{id}:publish`, and `startIndex` is where it starts.
 *
 * - `{name}` and `{+name}` filling a whole segment are params.
 * - `{name}` with literal text around it in a segment is a param too, unless two
 *   params in the segment touch, as in `{a}{b}`.
 * - Anything else is literal text.
 */
export function getDynamicPathParams(path: `/${string}`):
  | {
      segment: string
      startIndex: number
      parameterName: string
      allowsSlash: boolean
    }[]
  | undefined {
  if (!path.includes('{')) {
    return undefined
  }

  const len = path.length
  let params:
    | {
        segment: string
        startIndex: number
        parameterName: string
        allowsSlash: boolean
      }[]
    | undefined

  let index = 1

  while (index < len) {
    const segmentStart = index
    const slashPos = path.indexOf('/', index)
    const segmentEnd = slashPos === -1 ? len : slashPos
    const segment = path.slice(segmentStart, segmentEnd)

    if (segment.charCodeAt(0) === 123 && segment.charCodeAt(segment.length - 1) === 125) {
      const allowsSlash = segment.charCodeAt(1) === 43
      const parameterName = segment.slice(allowsSlash ? 2 : 1, -1)

      if (PARAMETER_NAME_REGEX.test(parameterName)) {
        params ??= []
        params.push({ segment, startIndex: segmentStart, parameterName, allowsSlash })
        index = segmentEnd + 1
        continue
      }
    }

    if (segment.includes('{')) {
      const matches = [...segment.matchAll(SEGMENT_PARAMETER_REGEX)]
      const touching = matches.some(
        (match, i) => i > 0 && matches[i - 1]!.index + matches[i - 1]![0].length === match.index,
      )

      if (!touching) {
        for (const match of matches) {
          params ??= []
          params.push({
            segment: match[0],
            startIndex: segmentStart + match.index,
            parameterName: match[1]!,
            allowsSlash: false,
          })
        }
      }
    }

    index = segmentEnd + 1
  }

  return params
}
