/* oxlint-disable typescript/no-wrapper-object-types -- boxed primitives as data */
import { Buffer } from 'node:buffer'

import type { Schema as ORPCSchema } from '@orpc/server'
import { os, type } from '@orpc/server'

/** A class holding a value, written by `JSON.stringify` */
export class Holder<T> {
  constructor(public v: T) {}
}

export class Stamp extends Date {}

export class LabeledDate extends Date {
  label = 'x'
}

export class Tags extends Set<string> {}

export class Lookup extends Map<string, number> {}

export class List extends Array<number> {}

export class AppError extends Error {
  code = 1
}

const stream = (): ReadableStream<string> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue('a')
      controller.close()
    },
  })

const form = (): FormData => {
  const data = new FormData()
  data.append('a', 'b')
  return data
}

/** Slots of a typed array, whose value may be a Buffer, written by its own `toJSON` */
export interface BufferSlots {
  v: Uint8Array
  exact: Uint8Array<ArrayBuffer>
  list: Uint8Array[]
  maybe: Readonly<Uint8Array> | null
  dict: Record<string, Readonly<Uint8Array>>
  partial: Partial<Uint8Array>
  picked: Pick<Uint8Array, 'length'>
}

const bufferSlots = (): BufferSlots => ({
  v: Buffer.from('ab'),
  exact: Buffer.from('ab'),
  list: [Buffer.from('ab')],
  maybe: Buffer.from('ab'),
  dict: { a: Buffer.from('ab') },
  partial: Buffer.from('ab'),
  picked: Buffer.from('ab'),
})

/** An output returning a fresh value, and an input of its type */
const sample = <T>(schema: ORPCSchema<T, T>, value: () => NoInfer<T>) => ({
  output: os.handler((): T => value()),
  input: os.input(schema).handler(() => 1),
})

export const runtimeBuiltins = {
  Buffer: sample(type<{ v: Buffer }>(), () => ({ v: Buffer.from('ab') })),
  BufferSlots: sample(type<BufferSlots>(), bufferSlots),
  BufferRoot: sample(type<Uint8Array>(), () => Buffer.from('ab')),
  BufferHolder: sample(type<Holder<Uint8Array>>(), () => new Holder<Uint8Array>(Buffer.from('ab'))),
  BufferHolderView: sample(
    type<Readonly<Holder<Uint8Array>>>(),
    () => new Holder<Uint8Array>(Buffer.from('ab')),
  ),
  Int8Array: sample(type<Int8Array>(), () => Int8Array.of(-128, 127)),
  Uint8Array: sample(type<Uint8Array[]>(), () => [new Uint8Array([1, 2])]),
  Uint8ClampedArray: sample(type<Record<string, Uint8ClampedArray>>(), () => ({
    a: Uint8ClampedArray.of(255),
  })),
  Int16Array: sample(type<Int16Array | null>(), () => Int16Array.of(-32768)),
  Uint16Array: sample(type<Holder<Uint16Array>>(), () => new Holder(Uint16Array.of(65535))),
  Int32Array: sample(type<Readonly<Int32Array>>(), () => Int32Array.of(-1, 2147483647)),
  Uint32Array: sample(type<{ v: Partial<Uint32Array> }>(), () => ({
    v: Uint32Array.of(4294967295),
  })),
  Float32Array: sample(type<Pick<Float32Array, 'length'>>(), () => Float32Array.of(1.5)),
  Float64Array: sample(type<{ v: Float64Array | string }>(), () => ({ v: Float64Array.of(0.1) })),
  // a bigint item can not be written
  BigInt64Array: sample(type<BigInt64Array>(), () => new BigInt64Array(0)),
  BigUint64Array: sample(type<{ v: BigUint64Array }>(), () => ({ v: new BigUint64Array(0) })),
  ArrayBuffer: sample(type<{ v: ArrayBuffer }>(), () => ({ v: new ArrayBuffer(2) })),
  SharedArrayBuffer: sample(type<SharedArrayBuffer>(), () => new SharedArrayBuffer(2)),
  DataView: sample(type<DataView[]>(), () => [new DataView(new ArrayBuffer(2))]),
  URL: sample(type<URL>(), () => new URL('https://example.com/a?b=1#c')),
  URLSearchParams: sample(type<URLSearchParams>(), () => new URLSearchParams('a=1&b=2')),
  Headers: sample(type<{ v: Headers }>(), () => ({ v: new Headers({ a: 'b' }) })),
  FormData: sample(type<FormData>(), form),
  Blob: sample(type<{ v: Blob }>(), () => ({ v: new Blob(['x'], { type: 'text/plain' }) })),
  File: sample(type<File>(), () => new File(['abc'], 'a.txt')),
  ReadableStream: sample(type<ReadableStream<string>>(), stream),
  Request: sample(type<{ v: Request }>(), () => ({ v: new Request('http://localhost/x') })),
  Response: sample(type<Response[]>(), () => [Response.json({ a: 1 })]),
  AbortSignal: sample(type<{ v: AbortSignal }>(), () => ({ v: new AbortController().signal })),
  RegExp: sample(type<Record<string, RegExp>>(), () => ({ a: /a+/g })),
  // only a handler's result is awaited
  Promise: sample(type<{ v: Promise<Promise<number>> }>(), () => ({
    v: new Promise<Promise<number>>((resolve) => resolve(Promise.resolve(1))),
  })),
  WeakRef: sample(type<Holder<WeakRef<object>>>(), () => new Holder(new WeakRef({}))),
  WeakMap: sample(type<{ v: WeakMap<object, number> }>(), () => ({ v: new WeakMap() })),
  WeakSet: sample(type<WeakSet<object>[]>(), () => [new WeakSet()]),
  DateTimeFormat: sample(type<{ v: Intl.DateTimeFormat }>(), () => ({
    v: new Intl.DateTimeFormat('en'),
  })),
  NumberFormat: sample(type<Intl.NumberFormat[]>(), () => [new Intl.NumberFormat('en')]),
  Locale: sample(type<Intl.Locale | null>(), () => new Intl.Locale('en-US')),
  Collator: sample(type<Record<string, Intl.Collator>>(), () => ({ a: new Intl.Collator('en') })),
  PluralRules: sample(
    type<Holder<Intl.PluralRules>>(),
    () => new Holder(new Intl.PluralRules('en')),
  ),
  RelativeTimeFormat: sample(type<{ v: Readonly<Intl.RelativeTimeFormat> }>(), () => ({
    v: new Intl.RelativeTimeFormat('en'),
  })),
  ListFormat: sample(type<Intl.ListFormat[]>(), () => [new Intl.ListFormat('en')]),
  Segmenter: sample(type<{ v: Intl.Segmenter }>(), () => ({ v: new Intl.Segmenter('en') })),
  Symbol: sample(type<{ v: symbol; n: number }>(), () => ({ v: Symbol('a'), n: 1 })),
  BigInt: sample(type<bigint>(), () => -12345678901234567890n),
  BoxedString: sample(type<String>(), () => new String('a')),
  BoxedNumber: sample(type<{ v: Number }>(), () => ({ v: new Number(1) })),
  BoxedBoolean: sample(type<Boolean[]>(), () => [new Boolean(false)]),
  // a boxed bigint can not be written
  BoxedBigInt: sample(type<BigInt>(), () => 2n),
  BoxedSymbol: sample(type<{ v: Symbol }>(), () => ({ v: Object(Symbol('s')) as Symbol })),
  Error: sample(type<Error>(), () => Object.assign(new Error('m'), { code: 1 })),
  TypeError: sample(type<{ v: TypeError }>(), () => ({ v: new TypeError('m') })),
  RangeError: sample(type<RangeError[]>(), () => [new RangeError('m', { cause: 1 })]),
  SyntaxError: sample(type<SyntaxError | null>(), () => new SyntaxError('m')),
  ReferenceError: sample(type<Record<string, ReferenceError>>(), () => ({
    a: new ReferenceError('m'),
  })),
  EvalError: sample(type<Holder<EvalError>>(), () => new Holder(new EvalError('m'))),
  URIError: sample(type<Readonly<URIError>>(), () => new URIError('m')),
  AggregateError: sample(type<AggregateError>(), () => new AggregateError([new Error('a')], 'm')),
  DOMException: sample(type<{ v: DOMException }>(), () => ({
    v: new DOMException('m', 'AbortError'),
  })),
  ErrorSubclass: sample(type<AppError>(), () => new AppError('m')),
  Date: sample(type<Partial<Date>>(), () => new Date('2024-02-29T12:00:00.123Z')),
  DateSubclass: sample(type<{ v: Stamp }>(), () => ({ v: new Stamp(0) })),
  LabeledDateSubclass: sample(type<LabeledDate>(), () => new LabeledDate(0)),
  Map: sample(type<Map<string, number>>(), () => new Map([['a', 1]])),
  Set: sample(type<{ v: Set<string> }>(), () => ({ v: new Set(['a', 'b']) })),
  SetSubclass: sample(type<Tags>(), () => new Tags(['a'])),
  MapSubclass: sample(type<{ v: Lookup }>(), () => ({ v: new Lookup([['a', 1]]) })),
  ArraySubclass: sample(type<List>(), () => List.of(1, 2)),
}
