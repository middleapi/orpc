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

/** A brand over a value, which `JSON.stringify` writes as the value */
type Branded<T, N extends string> = T & { readonly __brand?: N }

/** Sent as the typed array its `toJSON` returns, by its index keys */
export class ToView {
  toJSON(): ArrayBufferView {
    return new Uint8Array([1, 2])
  }
}

/** Sent as the response its `toJSON` returns, whose getters are not written */
export class ToBody {
  toJSON(): Body {
    return new Response('x')
  }
}

/** Sent as the compression stream its `toJSON` returns */
export class ToTransform {
  toJSON(): GenericTransformStream {
    return new CompressionStream('gzip')
  }
}

/** Sent as the reader its `toJSON` returns */
export class ToReader {
  toJSON(): ReadableStreamGenericReader {
    return new ReadableStream().getReader()
  }
}

/** Sent as the transform stream its `toJSON` returns */
export class ToPair {
  toJSON(): ReadableWritablePair<string, string> {
    return new TransformStream()
  }
}

/** Sent as the branded set its `toJSON` returns */
export class ToSetBrand {
  toJSON(): Branded<ReadonlySet<number>, 'rs'> {
    return new Set([1])
  }
}

/** Sent as the branded response its `toJSON` returns */
export class ToBodyBrand {
  toJSON(): Branded<Body, 'bo'> {
    return new Response('x')
  }
}

/** Holds a value converted with `toJSON` in a field */
export class BodyHolder {
  constructor(readonly held: ToBody) {}
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

export const libraryToJson = {
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
  toInstances: os.handler(() => ({
    view: new ToView(),
    body: new ToBody(),
    transform: new ToTransform(),
    reader: new ToReader(),
    pair: new ToPair(),
    setBrand: new ToSetBrand(),
    bodyBrand: new ToBodyBrand(),
    nested: { held: new BodyHolder(new ToBody()) },
  })),
  readonlyDeepLink: os.handler((): ReadonlyDeep<ExpandingLink<number>> => link(3)),
}
