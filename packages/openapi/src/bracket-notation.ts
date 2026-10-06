import type { Segment } from '@orpc/shared'
import { getOwn, isPlainObject, NullProtoObj, setOwn } from '@orpc/shared'

export type BracketNotationSerializeResult = [string, unknown][]

export interface BracketNotationSerializerOptions {
  /**
   * Maximum number of empty slots that explicit array indexes may leave in total during deserialization
   * (e.g., `a[0]=x&a[3]=y` leaves 2). An index that would exceed it turns its array into an object
   * instead (e.g., `?arr[5000]=x` becomes `{ arr: { 5000: 'x' } }`).
   *
   * Empty slots take memory (a lone `?arr[999]=x` takes ~12KB in V8), and code iterating an array walks
   * every one of them, so this keeps both in line with the input.
   *
   * NOTE: Append-style notation (e.g., `arr[]`) never leaves empty slots.
   *
   * @default 1_000
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
    const guard = new InternalIntegerKeyGuard(this.maxDeserializingEmptySlots)

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
            : !(isLast && isPushStyle) && guard.claimArrayIndex(child, segment)

          if (!canStayArray) {
            arrayPushStyles.delete(child)
            child = isPushStyle ? internalPushStyleArrayToObject(child) : internalArrayToObject(child)
          }
        }

        if (child !== existing) {
          guard.setOwn(currentRef, nextSegment, child)
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
          guard.setOwn(currentRef, nextSegment, [current, value])
        }
      }
      else {
        guard.setOwn(currentRef, nextSegment, value)
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

/**
 * The largest array index. Larger integer keys are ordinary properties.
 */
const MAX_ARRAY_INDEX = 2 ** 32 - 2

/**
 * Returns `key` as an array index (no sign, no leading zeros), which is also how engines store the
 * integer keys of objects, or `undefined` if it is not one.
 */
function internalToArrayIndex(key: string): number | undefined {
  // `MAX_ARRAY_INDEX` has 10 digits
  if (key.length === 0 || key.length > 10) {
    return undefined
  }

  let index = key.charCodeAt(0) - 48 // '0'

  if (index < 0 || index > 9 || (index === 0 && key.length > 1)) {
    return undefined
  }

  for (let i = 1; i < key.length; i++) {
    const digit = key.charCodeAt(i) - 48

    if (digit < 0 || digit > 9) {
      return undefined
    }

    index = index * 10 + digit
  }

  return index <= MAX_ARRAY_INDEX ? index : undefined
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
 * Engines keep the integer keys of an object in a flat backing store sized by the largest one, so a lone
 * `{ 999: x }` takes ~12KB in V8. Holding `MAX_ARRAY_INDEX` switches the object to sparse storage for good
 * (V8 and JSC), so writing and deleting it keeps every integer key the object receives later cheap.
 */
function internalUseSparseIntegerKeys(object: Record<string, unknown>): void {
  if (!Object.hasOwn(object, MAX_ARRAY_INDEX)) {
    object[MAX_ARRAY_INDEX] = undefined
    delete object[MAX_ARRAY_INDEX]
  }
}

/**
 * Keeps the memory that integer keys take in line with the input, see `maxDeserializingEmptySlots`.
 */
class InternalIntegerKeyGuard {
  private emptySlots = 0
  private sparseObjects: WeakSet<object> | undefined

  constructor(private readonly maxEmptySlots: number) {}

  /**
   * Counts the empty slots that `key` leaves in `array`.
   *
   * @returns `false`, counting nothing, if `key` is not an array index or its empty slots do not fit,
   * so `array` should become an object instead.
   */
  claimArrayIndex(array: readonly unknown[], key: string): boolean {
    const index = internalToArrayIndex(key)

    if (index === undefined) {
      return false
    }

    const slots = Math.max(0, index - array.length)

    if (this.emptySlots + slots > this.maxEmptySlots) {
      return false
    }

    this.emptySlots += slots
    return true
  }

  /**
   * Adds `key` to `container`. Arrays only receive keys already counted by `claimArrayIndex`, while
   * objects created during deserialization switch to sparse storage before an integer key that leaves a gap.
   */
  setOwn(container: Record<string, unknown>, key: string, value: unknown): void {
    if (container instanceof NullProtoObj && !this.sparseObjects?.has(container)) {
      const index = internalToArrayIndex(key)

      // `0`, or the key right after an existing one, keeps the flat store filled
      if (index !== undefined && index !== 0 && !Object.hasOwn(container, index - 1)) {
        internalUseSparseIntegerKeys(container)
        this.sparseObjects ??= new WeakSet()
        this.sparseObjects.add(container)
      }
    }

    setOwn(container, key, value)
  }
}
