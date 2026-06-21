import type { Segment } from '@orpc/shared'
import { isPlainObject, NullProtoObj } from '@orpc/shared'

export type BracketNotationSerializeResult = [string, unknown][]

export interface BracketNotationSerializerOptions {
  /**
   * Maximum explicit array index allowed during deserialization (e.g., `arr[0]`, `arr[999]`).
   * If the index exceeds this limit, the array is deserialized as an object instead.
   *
   * This guards against memory exhaustion attacks where malicious input uses extremely large
   * indices (e.g., `?arr[4294967296]=value`). Although orpc uses sparse arrays handle large indices
   * efficiently, downstream code may inadvertently densify them - creating millions of
   * undefined slots and exhausting memory.
   *
   * NOTE: Does not apply to append-style notation (e.g., `arr[]`).
   *
   * @default 999 (array with 1,000 elements)
   */
  maxExplicitDeserializingArrayIndex?: number
}

export class BracketNotationSerializer {
  private readonly maxExplicitDeserializingArrayIndex: number

  constructor(options: BracketNotationSerializerOptions = {}) {
    this.maxExplicitDeserializingArrayIndex = options.maxExplicitDeserializingArrayIndex ?? 999
  }

  serialize(data: unknown): BracketNotationSerializeResult {
    return this.internalSerialize(data, [], [])
  }

  private internalSerialize(data: unknown, segments: Segment[], result: BracketNotationSerializeResult): BracketNotationSerializeResult {
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        this.internalSerialize(item, [...segments, i], result)
      })
    }

    else if (isPlainObject(data)) {
      for (const key in data) {
        this.internalSerialize(data[key], [...segments, key], result)
      }
    }

    else {
      result.push([this.stringifyPath(segments), data])
    }

    return result
  }

  deserialize(serialized: BracketNotationSerializeResult): Record<string, unknown> {
    if (serialized.length === 0) {
      return new NullProtoObj() // Prevent Prototype Pollution with NullProtoObj
    }

    const arrayPushStyles = new WeakSet()
    const ref: { value: Record<string, unknown> } = { value: new NullProtoObj() } // Prevent Prototype Pollution with NullProtoObj

    for (const [path, value] of serialized) {
      const segments = this.parsePath(path)

      let currentRef: any = ref
      let nextSegment: string = 'value'

      segments.forEach((segment, i) => {
        if (!Array.isArray(currentRef[nextSegment]) && !isPlainObject(currentRef[nextSegment])) {
          currentRef[nextSegment] = []
        }

        if (i !== segments.length - 1) {
          if (Array.isArray(currentRef[nextSegment]) && !internalIsValidArrayIndex(segment, this.maxExplicitDeserializingArrayIndex)) {
            if (arrayPushStyles.has(currentRef[nextSegment])) {
              arrayPushStyles.delete(currentRef[nextSegment])
              currentRef[nextSegment] = internalPushStyleArrayToObject(currentRef[nextSegment])
            }
            else {
              currentRef[nextSegment] = internalArrayToObject(currentRef[nextSegment])
            }
          }
        }
        else {
          if (Array.isArray(currentRef[nextSegment])) {
            if (segment === '') {
              if (currentRef[nextSegment].length && !arrayPushStyles.has(currentRef[nextSegment])) {
                currentRef[nextSegment] = internalArrayToObject(currentRef[nextSegment])
              }
            }
            else {
              if (arrayPushStyles.has(currentRef[nextSegment])) {
                arrayPushStyles.delete(currentRef[nextSegment])
                currentRef[nextSegment] = internalPushStyleArrayToObject(currentRef[nextSegment])
              }

              else if (!internalIsValidArrayIndex(segment, this.maxExplicitDeserializingArrayIndex)) {
                currentRef[nextSegment] = internalArrayToObject(currentRef[nextSegment])
              }
            }
          }
        }

        currentRef = currentRef[nextSegment]
        nextSegment = segment
      })

      if (Array.isArray(currentRef) && nextSegment === '') {
        arrayPushStyles.add(currentRef)
        currentRef.push(value)
      }
      else if (nextSegment in currentRef) {
        if (Array.isArray(currentRef[nextSegment])) {
          currentRef[nextSegment].push(value)
        }
        else {
          currentRef[nextSegment] = [currentRef[nextSegment], value]
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
      .reduce<string>((result, segment, i) => {
        if (i === 0) {
          return segment.toString()
        }

        return `${result}[${segment}]`
      }, '')
  }

  parsePath(path: string): string[] {
    const segments: string[] = []

    let inBrackets = false
    let currentSegment = ''

    for (let i = 0; i < path.length; i++) {
      const char = path[i]!
      const nextChar = path[i + 1]

      if (inBrackets && char === ']' && (nextChar === undefined || nextChar === '[')) {
        if (nextChar === undefined) {
          inBrackets = false
        }

        segments.push(currentSegment)
        currentSegment = ''
        i++
      }

      else if (segments.length === 0 && char === '[') {
        inBrackets = true
        segments.push(currentSegment)
        currentSegment = ''
      }

      else {
        currentSegment += char
      }
    }

    return inBrackets || segments.length === 0 ? [path] : segments
  }
}

function internalIsValidArrayIndex(value: string, maxIndex: number): boolean {
  return /^0$|^[1-9]\d*$/.test(value) && Number(value) <= maxIndex
}

function internalArrayToObject(array: readonly unknown[]): Record<string, unknown> {
  const obj = new NullProtoObj() // Prevent Prototype Pollution with NullProtoObj

  array.forEach((item, i) => {
    obj[i] = item
  })

  return obj
}

function internalPushStyleArrayToObject(array: readonly unknown[]): Record<string, unknown> {
  const obj = new NullProtoObj()

  obj[''] = array.length === 1 ? array[0] : array

  return obj
}
