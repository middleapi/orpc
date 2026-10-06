import type { Segment } from '@orpc/shared'
import { getOwn, isPlainObject, NullProtoObj, setOwn } from '@orpc/shared'

export type BracketNotationSerializeResult = [string, unknown][]

export interface BracketNotationSerializerOptions {
  /**
   * Maximum number of empty slots that integer keys may leave in total during deserialization
   * (e.g., `a[0]=x&a[3]=y` leaves 2, and `b[5]=z` leaves 5).
   *
   * Empty array slots take memory, and code iterating an array walks every one of them. JS engines
   * also reserve memory for the empty slots below the integer keys of objects (a lone `?a[999]=x`
   * takes ~12KB in V8). This limit keeps both in line with the input:
   * - An array index that would exceed it turns its array into an object instead
   *   (e.g., `?arr[5000]=x` becomes `{ arr: { 5000: 'x' } }`).
   * - An object key that would exceed it throws a `TypeError`. Keys far past the existing ones
   *   (e.g., `?a[1700000000000]=x`) do not count, because engines store those sparsely.
   *
   * NOTE: Append-style notation (e.g., `arr[]`) never leaves empty slots.
   *
   * @default 1_000 (~12KB in V8)
   */
  maxDeserializingEmptySlots?: number
}

export class BracketNotationSerializer {
  private readonly maxDeserializingEmptySlots: number

  constructor(options: BracketNotationSerializerOptions = {}) {
    this.maxDeserializingEmptySlots = options.maxDeserializingEmptySlots ?? 1_000
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
            : !(isLast && isPushStyle) && emptySlots.claimArrayIndex(child, segment)

          if (!canStayArray) {
            arrayPushStyles.delete(child)
            child = isPushStyle ? internalPushStyleArrayToObject(child) : internalArrayToObject(child)
          }
        }

        if (child !== existing) {
          emptySlots.set(currentRef, nextSegment, child)
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
          emptySlots.set(currentRef, nextSegment, [current, value])
        }
      }
      else {
        emptySlots.set(currentRef, nextSegment, value)
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

/**
 * Returns `key` as an array index, which is also how engines store the integer keys of objects,
 * or `undefined` if it is not one. Integer keys past `2 ** 32 - 2` are ordinary properties.
 */
function internalToArrayIndex(key: string): number | undefined {
  const index = INTEGER_PATTERN.test(key) ? Number(key) : undefined
  return index !== undefined && index <= 4294967294 ? index : undefined
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
 * V8 grows a flat backing store to `1.5 * span + 16` slots and keeps integer keys in it while they land
 * within 1,024 slots past its end. A key further out switches the object to sparse storage.
 */
function internalIsNearIndex(index: number, span: number): boolean {
  return index < span * 1.5 + 16 + 1024
}

/**
 * V8 keeps a flat backing store past 5,000 slots (index ~3,300) only when the object is dense enough,
 * so empty slots past this index already take memory in line with the keys present.
 */
const MAX_COUNTED_OBJECT_INDEX = 4096

/**
 * One past the largest array index among the own keys of `object`.
 */
function internalGetObjectSpan(object: object): number {
  let span = 0

  for (const key of Object.keys(object)) {
    const index = internalToArrayIndex(key)

    if (index !== undefined && index >= span) {
      span = index + 1
    }
  }

  return span
}

/**
 * Counts the empty slots that integer keys leave below them, see `maxDeserializingEmptySlots`.
 */
class InternalEmptySlotBudget {
  // One past the largest array index of each object, or `Infinity` once V8 stores it sparsely
  private spans: WeakMap<object, number> | undefined
  private used = 0

  constructor(private readonly max: number) {}

  /**
   * Counts every empty slot that `key` leaves in `array`, since code iterating an array walks them all.
   *
   * @returns `false`, counting nothing, if `key` is not an array index or its empty slots do not fit,
   * so `array` should become an object instead.
   */
  claimArrayIndex(array: readonly unknown[], key: string): boolean {
    const index = internalToArrayIndex(key)

    if (index === undefined) {
      return false
    }

    const slots = index - array.length

    if (slots > 0) {
      if (this.used + slots > this.max) {
        return false
      }

      this.used += slots
    }

    return true
  }

  /**
   * Adds `key` to `container`, counting the empty slots it leaves in an object.
   * Arrays only receive keys already counted by `claimArrayIndex`.
   *
   * @throws {TypeError} If those empty slots do not fit.
   */
  set(container: object, key: string, value: unknown): void {
    if (!Array.isArray(container)) {
      this.claimObjectKey(container, key)
    }

    setOwn(container, key, value)
  }

  private claimObjectKey(object: object, key: string): void {
    const index = internalToArrayIndex(key)

    if (index === undefined) {
      return
    }

    // An object seen for the first time starts from its own keys (e.g., a converted array or a caller-supplied value)
    let span = this.spans?.get(object)

    if (span === undefined) {
      span = internalGetObjectSpan(object)
      this.setSpan(object, span)
    }

    if (index < span) {
      return
    }

    if (!internalIsNearIndex(index, span)) {
      this.setSpan(object, Infinity)
      return
    }

    const slots = Math.min(index, MAX_COUNTED_OBJECT_INDEX) - span

    if (slots > 0) {
      this.used += slots

      if (this.used > this.max) {
        throw new TypeError(`Invalid bracket notation: integer keys leave more than ${this.max} empty slots (maxDeserializingEmptySlots).`)
      }
    }

    this.setSpan(object, index + 1)
  }

  private setSpan(object: object, span: number): void {
    (this.spans ??= new WeakMap()).set(object, span)
  }
}
