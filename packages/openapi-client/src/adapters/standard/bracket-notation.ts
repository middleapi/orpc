import type { Segment } from '@orpc/shared'
import { isObject } from '@orpc/shared'

export type StandardBracketNotationSerialized = [string, unknown][]

export class StandardBracketNotationSerializer {
  serialize(data: unknown, segments: Segment[] = [], result: StandardBracketNotationSerialized = []): StandardBracketNotationSerialized {
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        this.serialize(item, [...segments, i], result)
      })
    }

    else if (isObject(data)) {
      for (const key in data) {
        this.serialize(data[key], [...segments, key], result)
      }
    }

    else {
      result.push([this.stringifyPath(segments), data])
    }

    return result
  }

  deserialize(serialized: StandardBracketNotationSerialized): Record<string, unknown> | unknown[] {
    if (serialized.length === 0) {
      return {}
    }

    const arrayPushStyles = new WeakSet()
    const ref: { value: Record<string, unknown> | unknown[] } = { value: [] }

    for (const [path, value] of serialized) {
      const segments = this.parsePath(path)

      let currentRef: any = ref
      let nextSegment: string = 'value'

      segments.forEach((segment, i) => {
        if (!Array.isArray(currentRef[nextSegment]) && !isObject(currentRef[nextSegment])) {
          currentRef[nextSegment] = []
        }

        if (i !== segments.length - 1) {
          if (Array.isArray(currentRef[nextSegment]) && !isValidArrayIndex(segment)) {
            currentRef[nextSegment] = { ...currentRef[nextSegment] }
          }
        }
        else {
          if (Array.isArray(currentRef[nextSegment])) {
            if (segment === '') {
              if (currentRef[nextSegment].length && !arrayPushStyles.has(currentRef[nextSegment])) {
                currentRef[nextSegment] = { ...currentRef[nextSegment] }
              }
            }
            else {
              if (arrayPushStyles.has(currentRef[nextSegment])) {
                currentRef[nextSegment] = { '': currentRef[nextSegment].at(-1) }
              }

              else if (!isValidArrayIndex(segment)) {
                currentRef[nextSegment] = { ...currentRef[nextSegment] }
              }
            }
          }
        }

        currentRef = currentRef[nextSegment]
        nextSegment = segment
      })

      if (Array.isArray(currentRef)) {
        if (nextSegment === '') {
          arrayPushStyles.add(currentRef)
          currentRef.push(value)
        }
        else {
          currentRef[Number(nextSegment)] = value
        }
      }
      else {
        currentRef[nextSegment] = value
      }
    }

    return ref.value
  }

  stringifyPath(segments: readonly Segment[]): string {
    return segments
      .map((segment) => {
        return segment.toString().replace(/[\\[\]]/g, (match) => {
          switch (match) {
            case '\\':
              return '\\\\'
            case '[':
              return '\\['
            case ']':
              return '\\]'
            /* v8 ignore next 2 */
            default:
              return match
          }
        })
      })
      .reduce((result, segment, i) => {
        if (i === 0) {
          return segment
        }

        return `${result}[${segment}]`
      }, '')
  }

  parsePath(path: string): string[] {
    const segments: string[] = []

    let inBrackets = false
    let currentSegment = ''
    let backslashCount = 0

    for (let i = 0; i < path.length; i++) {
      const char = path[i]!
      const nextChar = path[i + 1]

      if (inBrackets && char === ']' && (nextChar === undefined || nextChar === '[') && backslashCount % 2 === 0) {
        if (nextChar === undefined) {
          inBrackets = false
        }

        segments.push(currentSegment)
        currentSegment = ''
        i++
      }

      else if (segments.length === 0 && char === '[' && backslashCount % 2 === 0) {
        inBrackets = true
        segments.push(currentSegment)
        currentSegment = ''
      }

      else if (char === '\\') {
        backslashCount++
      }

      else {
        currentSegment += '\\'.repeat(backslashCount / 2) + char
        backslashCount = 0
      }
    }

    return inBrackets || segments.length === 0 ? [path] : segments
  }
}

function isValidArrayIndex(value: string): boolean {
  return /^0$|^[1-9]\d*$/.test(value)
}
