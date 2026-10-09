import type { Segment } from '@orpc/shared'
import { getOwn, isPlainObject, NullProtoObj, setOwn } from '@orpc/shared'

export type BracketNotationSerializeResult = [string, unknown][]

const INTEGER_PATTERN = /^0$|^[1-9]\d*$/

export interface BracketNotationSerializerOptions {
  /**
   * Maximum total number of empty slots that explicit array indexes may create during a single
   * deserialization (e.g., `arr[5]` on an empty array creates 5 empty slots). Once the budget is
   * spent, any array that would need more empty slots is deserialized as an object instead.
   *
   * This guards against memory exhaustion attacks where malicious input uses large indexes
   * (e.g., `?arr[4294967294]=value`) or many sparse arrays (e.g., `?a[999]=1&b[999]=1&...`).
   * Although sparse arrays store large indexes cheaply, downstream code may inadvertently
   * densify them, creating millions of undefined slots and exhausting memory.
   *
   * @default 1000
   */
  maxDeserializingEmptySlots?: number
}

export class BracketNotationSerializer {
  private readonly maxDeserializingEmptySlots: number

  constructor(options: BracketNotationSerializerOptions = {}) {
    this.maxDeserializingEmptySlots = options.maxDeserializingEmptySlots ?? 1000
  }

  serialize(data: unknown): BracketNotationSerializeResult {
    const result: BracketNotationSerializeResult = []
    this.internalSerialize(data, '', true, result)
    return result
  }

  private internalSerialize(data: unknown, path: string, isRoot: boolean, result: BracketNotationSerializeResult): void {
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        this.internalSerialize(item, isRoot ? i.toString() : `${path}[${i}]`, false, result)
      })
    }

    else if (isPlainObject(data)) {
      for (const key of Object.keys(data)) {
        this.internalSerialize(data[key], isRoot ? key : `${path}[${key}]`, false, result)
      }
    }

    else {
      result.push([path, data])
    }
  }

  deserialize(serialized: BracketNotationSerializeResult): Record<string, unknown> {
    // A caller-supplied object value can become a container for deeper paths, and unlike
    // `NullProtoObj` it carries a real prototype, so accesses below stay own-property only.
    const arrayPushStyles = new WeakSet()
    const root: Record<string, unknown> = new NullProtoObj()
    let remainingEmptySlots = this.maxDeserializingEmptySlots

    for (const [path, value] of serialized) {
      const segments = this.parsePath(path)

      let currentRef: any = root
      let nextSegment: string = segments[0]!

      for (let i = 1; i < segments.length; i++) {
        const segment = segments[i]!
        const isLast = i === segments.length - 1

        const existing: any = getOwn(currentRef, nextSegment)
        let child: any = existing

        if (!Array.isArray(child) && !isPlainObject(child)) {
          child = []
        }

        if (Array.isArray(child)) {
          const isPushStyle = arrayPushStyles.has(child)

          // indexes past the end leave empty slots, budgeted across all arrays in this call
          const emptySlots = Math.max(0, Number(segment) - child.length)

          const canStayArray = segment === ''
            ? isLast && (isPushStyle || child.length === 0)
            : INTEGER_PATTERN.test(segment) && !(isLast && isPushStyle) && emptySlots <= remainingEmptySlots

          if (canStayArray) {
            remainingEmptySlots -= emptySlots
          }
          else {
            arrayPushStyles.delete(child)
            child = isPushStyle ? internalPushStyleArrayToObject(child) : internalArrayToObject(child)
          }
        }

        if (child !== existing) {
          setOwn(currentRef, nextSegment, child)
        }

        currentRef = child
        nextSegment = segment
      }

      if (Array.isArray(currentRef) && nextSegment === '') {
        arrayPushStyles.add(currentRef)
        currentRef.push(value)
      }
      else if (Object.hasOwn(currentRef, nextSegment)) {
        const current = currentRef[nextSegment]

        if (Array.isArray(current)) {
          current.push(value)
        }
        else {
          setOwn(currentRef, nextSegment, [current, value])
        }
      }
      else {
        setOwn(currentRef, nextSegment, value)
      }
    }

    return root
  }

  stringifyPath(segments: readonly Segment[]): string {
    if (segments.length === 0) {
      return ''
    }

    let result = segments[0]!.toString()

    for (let i = 1; i < segments.length; i++) {
      result += `[${segments[i]}]`
    }

    return result
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
