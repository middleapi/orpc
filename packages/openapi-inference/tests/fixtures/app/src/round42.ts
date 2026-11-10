import { os } from '@orpc/server'
import type { ReadonlyDeep } from 'type-fest'

/** Expands each value again */
type Expanding<T> = T extends object ? { [K in keyof T]: Expanding<T[K]> } : T

/** Sent as the array, string, or set its `toJSON` returns */
export class ToIterable {
  constructor(private readonly items: Iterable<number>) {}

  toJSON(): Iterable<number> {
    return this.items
  }
}

/** Sent as the array, string, or plain object its `toJSON` returns */
export class ToArrayLike {
  constructor(private readonly items: ArrayLike<string>) {}

  toJSON(): ArrayLike<string> {
    return this.items
  }
}

/** Sent as the settled result its `toJSON` returns */
export class ToSettled {
  toJSON(): PromiseSettledResult<number> | null {
    return { status: 'fulfilled', value: 1 }
  }
}

/** Sent as the value its `toJSON` returns, which an `Object` may be of any type */
export class ToObject {
  constructor(private readonly value: string | object) {}

  // oxlint-disable-next-line typescript/no-wrapper-object-types
  toJSON(): Object {
    return this.value
  }
}

/** A generic model holding an expanding view of itself, which a deep mapped type of a library maps again */
export interface ExpandingLink<T> {
  v: T
  next: Expanding<ExpandingLink<T>> | null
}

const link = (depth: number): ExpandingLink<number> => ({
  v: depth,
  next: depth === 0 ? null : link(depth - 1),
})

export const roundFortyTwo = {
  toIterables: os.handler((): ToIterable[] => [
    new ToIterable([1, 2]),
    new ToIterable(new Set([3])),
  ]),
  toArrayLikes: os.handler((): ToArrayLike[] => [
    new ToArrayLike(['a']),
    new ToArrayLike({ length: 1, 0: 'b' }),
    new ToArrayLike('text'),
  ]),
  toObjects: os.handler((): ToObject[] => [new ToObject('text'), new ToObject({ a: 1 })]),
  toSettled: os.handler((): { settled: ToSettled } => ({ settled: new ToSettled() })),
  readonlyDeepLink: os.handler((): ReadonlyDeep<ExpandingLink<number>> => link(3)),
}
