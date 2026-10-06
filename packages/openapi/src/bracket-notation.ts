import type { Segment } from '@orpc/shared'
import { getOwn, isPlainObject, NullProtoObj, setOwn } from '@orpc/shared'

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

  /**
   * Maximum number of empty slots that integer keys may leave in total during deserialization
   * (e.g., `a[0]=x&a[3]=y` leaves 2, and `b[5]=z` leaves 5). Exceeding it throws a `TypeError`.
   *
   * JS engines store the integer keys of arrays and objects alike in a flat backing store with a slot
   * for every index below the largest one, so a lone `?a[999]=x` can take ~12KB. This limit keeps that
   * memory bounded no matter how many such keys the input repeats. Keys far past the existing ones
   * (e.g., `?a[1700000000000]=x`) are not counted, because engines store those sparsely.
   *
   * @default 10_000 (~120KB in V8)
   */
  maxDeserializingEmptySlots?: number
}

export class BracketNotationSerializer {
  private readonly maxExplicitDeserializingArrayIndex: number
  private readonly maxDeserializingEmptySlots: number

  constructor(options: BracketNotationSerializerOptions = {}) {
    this.maxExplicitDeserializingArrayIndex = options.maxExplicitDeserializingArrayIndex ?? 999
    this.maxDeserializingEmptySlots = options.maxDeserializingEmptySlots ?? 10_000
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
    const emptySlots = new InternalEmptySlotBudget(this.maxDeserializingEmptySlots)

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

          const canStayArray = segment === ''
            ? isLast && (isPushStyle || child.length === 0)
            : internalIsValidArrayIndex(segment, this.maxExplicitDeserializingArrayIndex) && !(isLast && isPushStyle)

          if (!canStayArray) {
            arrayPushStyles.delete(child)

            if (isPushStyle) {
              child = internalPushStyleArrayToObject(child)
            }
            else {
              const array = child
              child = internalArrayToObject(array)
              emptySlots.inheritSpan(array, child)
            }
          }
        }

        if (child !== existing) {
          emptySlots.claim(currentRef, nextSegment)
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
        emptySlots.claim(currentRef, nextSegment)
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

const INTEGER_PATTERN = /^0$|^[1-9]\d*$/
function internalIsValidArrayIndex(value: string, maxIndex: number): boolean {
  return INTEGER_PATTERN.test(value) && Number(value) <= maxIndex
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

/**
 * Counts the empty slots that integer keys leave below them, see `maxDeserializingEmptySlots`.
 *
 * Engines keep the integer keys of a container in a flat backing store while they stay close together.
 * V8 grows that store to `1.5 * span + 16` slots and keeps it flat for keys up to 1,024 slots past its
 * end, so only those keys are counted: a key further out switches the container to sparse storage.
 * Slots past index 4,096 are not counted either, since V8 keeps a store that large (5,000+ slots)
 * flat only when the container is dense enough, which keeps its memory in line with the input.
 */
class InternalEmptySlotBudget {
  // One past the largest integer key of each object; arrays use their length instead
  private spans: WeakMap<object, number> | undefined
  private remaining: number

  constructor(private readonly max: number) {
    this.remaining = max
  }

  /**
   * Carries the span of an array over to the object replacing it.
   */
  inheritSpan(array: readonly unknown[], object: object): void {
    if (array.length > 0) {
      this.setSpan(object, array.length)
    }
  }

  private setSpan(object: object, span: number): void {
    (this.spans ??= new WeakMap()).set(object, span)
  }

  /**
   * Call before adding `key` to `container`. Arrays only ever receive keys already checked by `internalIsValidArrayIndex`.
   *
   * @throws {TypeError} If the key leaves more empty slots than the budget has left.
   */
  claim(container: object, key: string): void {
    const isArray = Array.isArray(container)

    if (!isArray && !INTEGER_PATTERN.test(key)) {
      return
    }

    const index = Number(key)
    const span = isArray ? container.length : this.spans?.get(container) ?? 0

    if (index < span) {
      return
    }

    const slots = Math.min(index, 4096) - span

    if (slots > 0 && index < span * 1.5 + 16 + 1024 && !Object.hasOwn(container, key)) {
      if (slots > this.remaining) {
        throw new TypeError(`Invalid bracket notation: integer keys leave more than ${this.max} empty slots (maxDeserializingEmptySlots).`)
      }

      this.remaining -= slots
    }

    if (!isArray) {
      this.setSpan(container, index + 1)
    }
  }
}
